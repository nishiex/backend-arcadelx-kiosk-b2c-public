import { prisma } from "../../utils/db";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { CreateAgreementSchema } from "@shared-types/validationSchemas/agreement.validation";
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
    const { parent } = await lockAgreementParties(
      tx,
      parentOrgId,
      input.childOrgId,
      input.networkConnectionId,
    );
    await requireAgreementSlot(tx, parentOrgId, input.childOrgId, parent.type);
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
      parentSharePct = 60;
      childSharePct = 40;
      depositAmountPerMachine = upstream.depositAmountPerMachine;
      nonRefundableAmountPerMachine = upstream.nonRefundableAmountPerMachine;
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
    return tx.agreement.create({
      data: {
        networkConnectionId: input.networkConnectionId,
        parentOrgId,
        childOrgId: input.childOrgId,
        parentSharePct,
        childSharePct,
        depositAmountPerMachine,
        nonRefundableAmountPerMachine,
        status: "PENDING_APPROVAL",
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
        "Agreement drafted and sent for approval",
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

export const rejectAgreement = asyncHandler(async (req, res) => {
  await requireWorkflow('agreementRejection');
  const id = req.params.agreementId;
  if (typeof id !== 'string') throw new ApiError(400, 'Invalid agreement ID');
  const organizationId = req.membership!.organizationId;
  const agreement = await prisma.$transaction(async tx => {
    // Same child-organization lock and ordering as approval/termination.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
    const changed = await tx.agreement.updateMany({
      where: { id, childOrgId: organizationId, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED', effectiveTo: new Date() },
    });
    if (changed.count !== 1) throw new ApiError(404, 'Pending agreement not found or already processed');
    return tx.agreement.findUniqueOrThrow({ where: { id } });
  });
  res.json(new ApiResponse(200, { agreement }, 'Agreement rejected; history retained'));
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
