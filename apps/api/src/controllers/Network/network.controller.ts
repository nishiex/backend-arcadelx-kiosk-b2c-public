import type { Request, Response } from "express";
import { prisma } from "../../utils/db";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { InitiateConnectionSchema } from "@shared-types/validationSchemas/network.validation";
import { PaginationQuerySchema } from "@shared-types/validationSchemas/member.validation";
import { DistributorParamsSchema, DistributorStatusSchema } from "@shared-types/validationSchemas/distributor.validation";
import { requireWorkflow } from '../../services/workflow-readiness';
/** 
@params targetOwnerEmail
*/
export const initiateConnection = asyncHandler(
  async (req: Request, res: Response) => {
    const { targetOwnerEmail } = InitiateConnectionSchema.parse(req.body);
    const initiatorOrgId = req.membership!.organizationId;

    const InitiatorOrganization = await prisma.organization.findFirst({
      where: {
        id: initiatorOrgId,
      },
      select: {
        type: true,
      },
    });

    const targetOwner = await prisma.user.findFirst({
      where: {
        email: targetOwnerEmail,
      },
      include: {
        ownedOrganizations: {
          select: {
            id: true,
            type: true,
          },
        },
      },
    });

    if (!targetOwner)
      throw new ApiError(404, "No organization found for this owner email");

    const targetOrg = targetOwner!.ownedOrganizations[0];

    if (!targetOrg)
      throw new ApiError(404, "No organization found for this owner email");

    if (initiatorOrgId === targetOrg.id)
      throw new ApiError(400, "You cannot connect with your own organization");

    const initiatorType = InitiatorOrganization!.type;
    const targetType = targetOrg.type;

    // Only a parent can make request to the child i.e COMPANY -> PARTNER , COMPANY->DISTRIBUOTR , DISTRIBUOR->PARTENR;PARTNER is handled in the route itlsef, as he is restricted to even access this route so now worries
    if (
      initiatorType === "DISTRIBUTOR" &&
      (targetType === "COMPANY" || targetType === "DISTRIBUTOR")
    )
      throw new ApiError(
        405,
        `${initiatorType} cannot make connection requests to ${targetType}`,
      );

    const existingConnection = await prisma.networkConnection.findFirst({
      where: {
        OR: [
          { initiatorOrgId: initiatorOrgId, receiverOrgId: targetOrg.id },
          { initiatorOrgId: targetOrg.id, receiverOrgId: initiatorOrgId },
        ],
      },
    });

    if (existingConnection)
      throw new ApiError(
        409,
        `Connection already exists with status: ${existingConnection.status}`,
      );

    const connection = await prisma.networkConnection.create({
      data: {
        initiatorOrgId,
        receiverOrgId: targetOrg.id,
        status: "PENDING",
      },
    });

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { connection },
          "Connection request sent successfully",
        ),
      );
  },
);

export const getPendingNetworkRequests = asyncHandler(
  async (req: Request, res: Response) => {
    const { page, limit } = PaginationQuerySchema.parse(req.query);

    const skip = (page - 1) * limit;
    const orgId = req.membership!.organizationId;

    const [total, requests] = await prisma.$transaction([
      prisma.networkConnection.count({
        where: {
          receiverOrgId: orgId,
          status: "PENDING",
        },
      }),

      prisma.networkConnection.findMany({
        where: {
          receiverOrgId: orgId,
          status: "PENDING",
        },
        skip,
        take: limit,
        orderBy: {
          createdAt: "asc",
        },
        include: {
          initiator: {
            select: {
              id: true,
              name: true,
              type: true,
              state: true,
              city: true,
              pincode: true,
              address: true,
              owner: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
    ]);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          data: requests,
          meta: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
          },
        },
        "Pending network requests fetched successfully",
      ),
    );
  },
);

export const acceptConnection = asyncHandler(
  async (req: Request, res: Response) => {
    const { connectionId } = req.params;
    const currentOrgId = req.membership!.organizationId;

    if (typeof connectionId !== "string")
      throw new ApiError(400, "Invalid connection ID");

    const accepted = await prisma.networkConnection.updateMany({
      where: {
        id: connectionId,
        receiverOrgId: currentOrgId,
        status: "PENDING",
      },
      data: { status: "ACTIVE" },
    });
    if (accepted.count !== 1)
      throw new ApiError(404, "Pending connection request not found");
    const updatedConnection = await prisma.networkConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { connection: updatedConnection },
          "Connection accepted successfully",
        ),
      );
  },
);

// Recipient decisions compete on the same conditional PENDING transition.
export const rejectConnection = asyncHandler(async (req, res) => {
  await requireWorkflow('networkRejection');
  const connectionId = req.params.connectionId;
  if (typeof connectionId !== 'string') throw new ApiError(400, 'Invalid connection ID');
  const changed = await prisma.networkConnection.updateMany({
    where: { id: connectionId, receiverOrgId: req.membership!.organizationId, status: 'PENDING' },
    data: { status: 'REJECTED' },
  });
  if (changed.count !== 1) throw new ApiError(404, 'Pending connection request not found or already processed');
  res.status(200).json(new ApiResponse(200, null, 'Connection request rejected'));
});

export const getConnections = asyncHandler(async (req, res) => {
  const { page, limit } = PaginationQuerySchema.parse(req.query);
  const organizationId = req.membership!.organizationId;
  const where = { OR: [{ initiatorOrgId: organizationId }, { receiverOrgId: organizationId }] };
  const org = { select: { id: true, name: true, type: true } } as const;
  const [total, requests] = await prisma.$transaction([
    prisma.networkConnection.count({ where }),
    prisma.networkConnection.findMany({ where, skip: (page - 1) * limit, take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { initiator: org, reciever: org } }),
  ], { isolationLevel: 'RepeatableRead' });
  res.json(new ApiResponse(200, { requests, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } }));
});

export const deleteConnection = asyncHandler(
  async (req: Request, res: Response) => {
    const { connectionId } = req.params;
    const currentOrgId = req.membership!.organizationId;

    if (typeof connectionId !== "string")
      throw new ApiError(400, "Invalid connection ID");

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "NetworkConnection" WHERE id=${connectionId} FOR UPDATE`;
      const connection = await tx.networkConnection.findFirst({
        where: { id: connectionId, initiatorOrgId: currentOrgId },
      });
      if (!connection) throw new ApiError(404, "Connection not found");
      if (connection.status === 'REJECTED') throw new ApiError(409, 'Rejected connection history must be retained');
      if (
        await tx.agreement.count({
          where: { networkConnectionId: connectionId },
        })
      ) {
        throw new ApiError(
          409,
          "Cannot delete a connection with agreement history",
        );
      }
      await tx.networkConnection.delete({ where: { id: connectionId } });
    });

    res
      .status(200)
      .json(
        new ApiResponse(200, null, "Network connection permanently removed"),
      );
  },
);

/**
 * List DISTRIBUTOR organizations for the company dashboard.
 *
 * Scope: single-company deployment, so every DISTRIBUTOR-type org is visible to
 * the COMPANY. If multi-company tenancy is introduced later, narrow this by
 * NetworkConnection (company as initiator/receiver of the link).
 *
 * Profile columns may not exist until the lifecycle migration is deployed.
 * Select only available profile columns; retain nulls for absent fields.
 */
export const getDistributors = asyncHandler(
  async (_req: Request, res: Response) => {
    const profileColumns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Organization'
        AND column_name IN ('gstNumber', 'phone', 'country', 'isActive', 'accessVersion')
    `;
    const availableProfileColumns = new Set(
      profileColumns.map(({ column_name }) => column_name),
    );
    const organizations = await prisma.organization.findMany({
      where: { type: "DISTRIBUTOR" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        state: true,
        city: true,
        pincode: true,
        gstNumber: availableProfileColumns.has("gstNumber"),
        phone: availableProfileColumns.has("phone"),
        country: availableProfileColumns.has("country"),
        isActive: availableProfileColumns.has("isActive"),
        createdAt: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            kiosks: true,
            memberships: true,
          },
        },
      },
    });

    const distributors = organizations.map((organization) => ({
      ...organization,
      gstNumber: organization.gstNumber ?? null,
      phone: organization.phone ?? null,
      country: organization.country ?? null,
      isActive: organization.isActive ?? true,
      statusManagementAvailable: availableProfileColumns.has("isActive") && availableProfileColumns.has("accessVersion"),
    }));

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { distributors },
          "Distributors fetched successfully",
        ),
      );
  },
);

export const setDistributorStatus = asyncHandler(async (req: Request, res: Response) => {
  const { distributorId } = DistributorParamsSchema.parse(req.params);
  const { isActive } = DistributorStatusSchema.parse(req.body);
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Organization'
      AND column_name IN ('isActive', 'accessVersion')
  `;
  if (columns.length !== 2) throw new ApiError(503, "Distributor status management requires the database update.");

  const distributor = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${distributorId} FOR UPDATE`;
    const current = await tx.organization.findFirst({
      where: { id: distributorId, type: "DISTRIBUTOR" },
      select: { id: true, isActive: true },
    });
    if (!current) throw new ApiError(404, "Distributor not found");
    const updated = await tx.organization.update({
      where: { id: distributorId },
      data: { isActive, ...(!isActive && current.isActive ? { accessVersion: { increment: 1 } } : {}) },
      select: { id: true, name: true, isActive: true },
    });
    if (!isActive) {
      // Preserve session records as well as business data when disabling access.
      await tx.refreshToken.updateMany({
        where: { user: { membership: { organizationId: distributorId } } },
        data: { revoked: true },
      });
    }
    return updated;
  });
  res.status(200).json(new ApiResponse(200, { distributor }, `Distributor ${isActive ? "activated" : "deactivated"} successfully`));
});
