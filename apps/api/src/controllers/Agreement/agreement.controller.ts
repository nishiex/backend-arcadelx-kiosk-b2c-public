import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import {
  CreateAgreementSchema,
  UpdateAgreementSchema,
} from "@shared-types/validationSchemas/agreement.validation";
import { PaginationQuerySchema } from "@shared-types/validationSchemas/member.validation";
import { requireWorkflow } from '../../services/workflow-readiness';
import {
  lockAgreementParties,
  requireAgreementSlot,
} from "../../services/agreement-rules";

export const createAgreement = asyncHandler(async (req, res) => {
  const input = CreateAgreementSchema.parse(req.body);
  const parentOrgId = req.membership!.organizationId;
  const agreement = await prisma.$transaction(async (tx) => {
    let networkConnectionId = input.networkConnectionId;
    if (!networkConnectionId) {
      // Sending an agreement is the relationship-creation action. Serialize on
      // the child so concurrent sends cannot create competing connections.
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${input.childOrgId} FOR UPDATE`;
      const [parent, child] = await Promise.all([
        tx.organization.findUnique({ where: { id: parentOrgId }, select: { id: true, type: true } }),
        tx.organization.findUnique({ where: { id: input.childOrgId }, select: { id: true, type: true, parentOrgId: true } }),
      ]);
      if (!parent || !child) throw new ApiError(404, "Organization not found");
      if (
        parentOrgId === child.id ||
        !((parent.type === "COMPANY" && ["DISTRIBUTOR", "PARTNER"].includes(child.type)) ||
          (parent.type === "DISTRIBUTOR" && child.type === "PARTNER"))
      ) {
        throw new ApiError(400, "Invalid parent/child organization relationship");
      }
      const existing = await tx.networkConnection.findFirst({
        where: { initiatorOrgId: parentOrgId, receiverOrgId: child.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (existing) {
        networkConnectionId = existing.id;
        if (existing.status !== "ACTIVE") {
          await tx.networkConnection.update({ where: { id: existing.id }, data: { status: "ACTIVE" } });
        }
      } else {
        const connection = await tx.networkConnection.create({
          data: { initiatorOrgId: parentOrgId, receiverOrgId: child.id, status: "ACTIVE" },
        });
        networkConnectionId = connection.id;
      }
    }
    const { parent } = await lockAgreementParties(
      tx,
      parentOrgId,
      input.childOrgId,
      networkConnectionId,
    );
    await requireAgreementSlot(tx, parentOrgId, input.childOrgId, parent.type);
    const childOrganization = await tx.organization.findUnique({
      where: { id: input.childOrgId },
      select: { type: true, parentOrgId: true },
    });
    if (!childOrganization) throw new ApiError(404, "Organization not found");
    let parentSharePct: number,
      childSharePct: number,
      depositAmountPerMachine: number,
      nonRefundableAmountPerMachine: number;
    if (parent.type === "DISTRIBUTOR") {
      const upstream = await tx.agreement.findFirst({
        where: {
          childOrgId: parentOrgId,
          parentOrg: { type: "COMPANY" },
          status: "ACTIVE",
        },
      });
      if (!upstream)
        throw new ApiError(
          400,
          "Distributor must have an active Company agreement",
        );
      if (
        (input.parentSharePct === undefined) !== (input.childSharePct === undefined) ||
        (input.depositAmountPerMachine === undefined) !== (input.nonRefundableAmountPerMachine === undefined)
      ) {
        throw new ApiError(400, "Distributor agreements require both shares and both per-kiosk amounts");
      }
      parentSharePct = input.parentSharePct ?? 60;
      childSharePct = input.childSharePct ?? 40;
      depositAmountPerMachine = input.depositAmountPerMachine ?? upstream.depositAmountPerMachine;
      nonRefundableAmountPerMachine = input.nonRefundableAmountPerMachine ?? upstream.nonRefundableAmountPerMachine;
    } else {
      if (
        input.parentSharePct === undefined ||
        input.childSharePct === undefined ||
        input.parentSharePct + input.childSharePct !== 100 ||
        input.depositAmountPerMachine === undefined ||
        input.nonRefundableAmountPerMachine === undefined
      ) {
        throw new ApiError(
          400,
          "Company agreements require shares totaling 100 and explicit amounts",
        );
      }
      parentSharePct = input.parentSharePct;
      childSharePct = input.childSharePct;
      depositAmountPerMachine = input.depositAmountPerMachine;
      nonRefundableAmountPerMachine = input.nonRefundableAmountPerMachine;
    }
    // Terms are approved by the supplying organization at creation time. Activating
    // immediately keeps the relationship ready for allocations without requiring a
    // second Owner action from the receiving organization.
    return tx.agreement.create({
      data: {
        networkConnectionId,
        parentOrgId,
        childOrgId: input.childOrgId,
        parentSharePct,
        childSharePct,
        depositAmountPerMachine,
        nonRefundableAmountPerMachine,
        status: "ACTIVE",
        effectiveFrom: new Date(),
      },
    });
  });
  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { agreement },
        "Agreement created and activated",
      ),
    );
});

export const approveAgreement = asyncHandler(async (req, res) => {
  const id = req.params.agreementId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid agreement ID");
  const agreement = await prisma.$transaction(async (tx) => {
    const candidate = await tx.agreement.findFirst({
      where: { id, childOrgId: req.membership!.organizationId },
    });
    if (!candidate)
      throw new ApiError(404, "Pending agreement not found or unauthorized");
    const { parent } = await lockAgreementParties(
      tx,
      candidate.parentOrgId,
      candidate.childOrgId,
      candidate.networkConnectionId,
    );
    await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id=${id} FOR UPDATE`;
    const current = await tx.agreement.findUniqueOrThrow({ where: { id } });
    if (current.status !== "PENDING_APPROVAL")
      throw new ApiError(404, "Pending agreement not found");
    await requireAgreementSlot(
      tx,
      current.parentOrgId,
      current.childOrgId,
      parent.type,
      id,
    );
    return tx.agreement.update({
      where: { id },
      data: { status: "ACTIVE", effectiveFrom: new Date() },
    });
  });
  res
    .status(200)
    .json(
      new ApiResponse(200, { agreement }, "Agreement approved and now active"),
    );
});

/**
 * Replace an active agreement without rewriting its history. The old row is
 * closed at the same instant the new row becomes effective, so revenue
 * statements can resolve the terms that were active for each transaction.
 */
async function replaceActiveAgreement(
  tx: Prisma.TransactionClient,
  current: {
    id: string;
    networkConnectionId: string;
    parentOrgId: string;
    childOrgId: string;
  },
  effectiveAt: Date,
  terms: {
    parentSharePct: number;
    childSharePct: number;
    depositAmountPerMachine: number;
    nonRefundableAmountPerMachine: number;
  },
) {
  await tx.agreement.update({
    where: { id: current.id },
    data: { status: "TERMINATED", effectiveTo: effectiveAt },
  });
  return tx.agreement.create({
    data: {
      networkConnectionId: current.networkConnectionId,
      parentOrgId: current.parentOrgId,
      childOrgId: current.childOrgId,
      parentSharePct: terms.parentSharePct,
      childSharePct: terms.childSharePct,
      depositAmountPerMachine: terms.depositAmountPerMachine,
      nonRefundableAmountPerMachine: terms.nonRefundableAmountPerMachine,
      status: "ACTIVE",
      effectiveFrom: effectiveAt,
    },
  });
}

export const updateAgreement = asyncHandler(async (req, res) => {
  const id = req.params.agreementId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid agreement ID");
  const input = UpdateAgreementSchema.parse(req.body);
  const parentOrgId = req.membership!.organizationId;

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id=${id} FOR UPDATE`;
    const current = await tx.agreement.findUnique({
      where: { id },
      include: {
        parentOrg: { select: { id: true, type: true } },
        childOrg: { select: { id: true, type: true } },
      },
    });
    if (!current || current.parentOrgId !== parentOrgId || current.status !== "ACTIVE") {
      throw new ApiError(404, "Active agreement not found or unauthorized");
    }
    if (current.parentOrg.type === "DISTRIBUTOR") {
      throw new ApiError(409, "Terminate the current Distributor agreement before creating new terms");
    }

    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${current.childOrgId} FOR UPDATE`;
    const effectiveAt = new Date();
    let terms: {
      parentSharePct: number;
      childSharePct: number;
      depositAmountPerMachine: number;
      nonRefundableAmountPerMachine: number;
    };

    if (current.parentOrg.type === "COMPANY") {
      if (
        input.parentSharePct === undefined ||
        input.childSharePct === undefined ||
        input.depositAmountPerMachine === undefined ||
        input.nonRefundableAmountPerMachine === undefined
      ) {
        throw new ApiError(
          400,
          "Company agreement updates require both shares and both per-kiosk amounts",
        );
      }
      terms = {
        parentSharePct: input.parentSharePct,
        childSharePct: input.childSharePct,
        depositAmountPerMachine: input.depositAmountPerMachine,
        nonRefundableAmountPerMachine: input.nonRefundableAmountPerMachine,
      };
    } else {
      const upstream = await tx.agreement.findFirst({
        where: {
          parentOrg: { is: { type: "COMPANY" } },
          childOrgId: current.parentOrgId,
          status: "ACTIVE",
        },
      });
      if (!upstream) {
        throw new ApiError(409, "Distributor has no active Company agreement");
      }
      if (
        (input.depositAmountPerMachine === undefined) !==
        (input.nonRefundableAmountPerMachine === undefined)
      ) {
        throw new ApiError(400, "Distributor agreements require both per-kiosk amounts");
      }
      terms = {
        parentSharePct: input.parentSharePct ?? Number(current.parentSharePct),
        childSharePct: input.childSharePct ?? Number(current.childSharePct),
        depositAmountPerMachine:
          input.depositAmountPerMachine ?? Number(current.depositAmountPerMachine),
        nonRefundableAmountPerMachine:
          input.nonRefundableAmountPerMachine ?? Number(current.nonRefundableAmountPerMachine),
      };
    }

    const agreement = await replaceActiveAgreement(tx, current, effectiveAt, terms);
    let cascadedAgreements = 0;

    return { agreement, cascadedAgreements };
  });

  res.json(
    new ApiResponse(
      200,
      result,
      result.cascadedAgreements
        ? `Agreement updated; ${result.cascadedAgreements} Partner agreement(s) also updated`
        : "Agreement updated successfully",
    ),
  );
});

export const terminateAgreement = asyncHandler(async (req, res) => {
  const id = req.params.agreementId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid agreement ID");
  const candidate = await prisma.agreement.findFirst({
    where: { id, parentOrgId: req.membership!.organizationId },
  });
  if (!candidate) throw new ApiError(404, "Active agreement not found");
  const agreement = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${candidate.childOrgId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id=${id} FOR UPDATE`;
    const current = await tx.agreement.findUniqueOrThrow({ where: { id } });
    if (current.status !== "ACTIVE")
      throw new ApiError(404, "Active agreement not found");
    return tx.agreement.update({
      where: { id },
      data: { status: "TERMINATED", effectiveTo: new Date() },
    });
  });
  res
    .status(200)
    .json(new ApiResponse(200, { agreement }, "Agreement terminated"));
});

export const getAgreements = asyncHandler(async (req, res) => {
  const { page, limit } = PaginationQuerySchema.parse(req.query);
  const organizationId = req.membership!.organizationId;
  const where = { OR: [{ parentOrgId: organizationId }, { childOrgId: organizationId }] };
  const org = { select: { id: true, name: true, type: true } } as const;
  const [total, agreements] = await prisma.$transaction([
    prisma.agreement.count({ where }),
    prisma.agreement.findMany({ where, skip: (page - 1) * limit, take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: { parentOrg: org, childOrg: org } }),
  ], { isolationLevel: 'RepeatableRead' });
  res.json(new ApiResponse(200, { agreements, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }));
});
