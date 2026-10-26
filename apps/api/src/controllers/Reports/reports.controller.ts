import { asyncHandler } from "../../utils/asyncHandler";
import { ApiResponse } from "../../utils/ApiResponse";
import { prisma } from "../../utils/db";

/**
 * Machine movement/addition report for the dashboard.
 *
 * This is intentionally derived from KioskAssignment, the existing ownership
 * ledger used by revenue attribution, so the report reflects real machine
 * events and does not require a second audit table or a parallel write path.
 */
export const getMachineActivity = asyncHandler(async (req, res) => {
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

  const kiosks = await prisma.kiosk.findMany({
    where: visibleOrganizationIds
      ? {
          OR: [
            { currentOrgId: { in: visibleOrganizationIds } },
            { assignments: { some: { organizationId: { in: visibleOrganizationIds } } } },
          ],
        }
      : {},
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      machineCode: true,
      model: true,
      status: true,
      createdAt: true,
      assignments: {
        where: visibleOrganizationIds ? { organizationId: { in: visibleOrganizationIds } } : {},
        orderBy: [{ assignedFrom: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          assignedFrom: true,
          assignedTo: true,
          organization: { select: { id: true, name: true, type: true } },
          assignedBy: { select: { name: true } },
          order: { select: { orderNumber: true } },
        },
      },
    },
  });

  const activity = kiosks.flatMap((kiosk) => kiosk.assignments.map((assignment) => ({
    id: assignment.id,
    action: Math.abs(assignment.assignedFrom.getTime() - kiosk.createdAt.getTime()) <= 1000
      ? "MACHINE_ADDED"
      : "MACHINE_ASSIGNED",
    machineCode: kiosk.machineCode,
    model: kiosk.model,
    status: kiosk.status,
    organization: assignment.organization,
    assignedBy: assignment.assignedBy?.name ?? null,
    assignedFrom: assignment.assignedFrom,
    assignedTo: assignment.assignedTo,
    orderNumber: assignment.order?.orderNumber ?? null,
  })));

  activity.sort((a, b) => b.assignedFrom.getTime() - a.assignedFrom.getTime());

  res.json(new ApiResponse(200, { activity }, "Machine activity fetched successfully"));
});
