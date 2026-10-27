import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/ApiResponse";
import { prisma } from "../../utils/db";
import { PaginationQuerySchema } from "@shared-types/validationSchemas/member.validation";

/**
 * Machine movement/addition report for the dashboard.
 *
 * This is intentionally derived from KioskAssignment, the existing ownership
 * ledger used by revenue attribution, so the report reflects real machine
 * events and does not require a second audit table or a parallel write path.
 */
export const getMachineActivity = asyncHandler(async (req, res) => {
  const { page, limit } = PaginationQuerySchema.parse(req.query);
  const organizationId = req.membership!.organizationId;
  const organizationType = req.membership!.type;

  const visibleOrganizationIds =
    organizationType === "COMPANY"
      ? undefined
      : organizationType === "DISTRIBUTOR"
        ? [
            organizationId,
            ...(await prisma.organization.findMany({
              where: { parentOrgId: organizationId, type: "PARTNER" },
              select: { id: true },
            })).map(({ id }) => id),
          ]
        : [organizationId];

  const assignmentWhere = visibleOrganizationIds
    ? { organizationId: { in: visibleOrganizationIds } }
    : {};
  const [total, assignments] = await Promise.all([
    prisma.kioskAssignment.count({ where: assignmentWhere }),
    prisma.kioskAssignment.findMany({
      where: assignmentWhere,
      orderBy: [{ assignedFrom: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        assignedFrom: true,
        assignedTo: true,
        organization: { select: { id: true, name: true, type: true } },
        assignedBy: { select: { name: true } },
        order: { select: { orderNumber: true } },
        kiosk: { select: { machineCode: true, model: true, status: true, createdAt: true } },
      },
    }),
  ]);

  const activity = assignments.map((assignment) => ({
    id: assignment.id,
    action: Math.abs(assignment.assignedFrom.getTime() - assignment.kiosk.createdAt.getTime()) <= 1000
      ? "MACHINE_ADDED"
      : "MACHINE_ASSIGNED",
    machineCode: assignment.kiosk.machineCode,
    model: assignment.kiosk.model,
    status: assignment.kiosk.status,
    organization: assignment.organization,
    assignedBy: assignment.assignedBy?.name ?? null,
    assignedFrom: assignment.assignedFrom,
    assignedTo: assignment.assignedTo,
    orderNumber: assignment.order?.orderNumber ?? null,
  }));

  res.json(new ApiResponse(200, {
    activity,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  }, "Machine activity fetched successfully"));
});
