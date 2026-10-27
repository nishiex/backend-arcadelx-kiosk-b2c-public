import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/ApiResponse";
import { prisma } from "../../utils/db";
import { PaginationQuerySchema } from "@shared-types/validationSchemas/member.validation";

export const getAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit } = PaginationQuerySchema.parse(req.query);
  const actorOrgType = typeof req.query.actorOrgType === "string" && ["COMPANY", "DISTRIBUTOR", "PARTNER"].includes(req.query.actorOrgType)
    ? req.query.actorOrgType as "COMPANY" | "DISTRIBUTOR" | "PARTNER" : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim().toUpperCase() : undefined;
  const entity = typeof req.query.entity === "string" ? req.query.entity.trim().toUpperCase() : undefined;
  const action = typeof req.query.action === "string" ? req.query.action.trim().toUpperCase() : undefined;
  const where = {
    ...(actorOrgType ? { actorOrgType } : {}),
    ...(entity ? { entity } : {}),
    ...(action ? { action } : {}),
    ...(search ? { OR: [
      { entity: { contains: search } },
      { action: { contains: search } },
      { actorName: { contains: search, mode: "insensitive" as const } },
      { path: { contains: search, mode: "insensitive" as const } },
      { reference: { contains: search, mode: "insensitive" as const } },
    ] } : {}),
  };
  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
  ]);
  res.json(new ApiResponse(200, { logs, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }, "Audit logs fetched successfully"));
});
