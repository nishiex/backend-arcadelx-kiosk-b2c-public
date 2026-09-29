import { prisma } from "../../utils/db";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { CreateAgreementSchema } from "@shared-types/validationSchemas/agreement.validation";
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
