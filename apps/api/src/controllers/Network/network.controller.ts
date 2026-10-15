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
  async (req: Request, res: Response) => {
    const companyOrgId = req.membership!.organizationId;
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

    // Partners genuinely associated with each Distributor, reachable from this Company.
    //
    // A Partner registration records no parent pointer (Organization has no self-relation),
    // so "associated" is taken from relationships that do exist and that the Company is
    // legitimately a party to. Two sources, both intersected with the Company's own network:
    //
    //   1. an ACTIVE NetworkConnection between a Distributor and the Partner, where the
    //      Distributor is one this Company is connected to, or
    //   2. an Agreement/Order between that Distributor and the Partner.
    //
    // Scoping rule: a Partner is only reported when a row links it to a Distributor *and* the
    // calling Company holds an ACTIVE connection to that Distributor, so every returned
    // organization stays inside the caller's own network. No schema change.
    const companyConnections = await prisma.networkConnection.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ initiatorOrgId: companyOrgId }, { receiverOrgId: companyOrgId }],
      },
      select: { initiatorOrgId: true, receiverOrgId: true },
    });

    // The organizations this Company is actually connected to (its own network).
    const connectedOrgIds = Array.from(
      new Set(
        companyConnections.map((connection) =>
          connection.initiatorOrgId === companyOrgId
            ? connection.receiverOrgId
            : connection.initiatorOrgId,
        ),
      ),
    );

    const partnersByDistributor = new Map<
      string,
      { id: string; name: string; type: string; state: string | null; city: string | null; owner: { id: string; name: string; email: string } | null }[]
    >();

    if (connectedOrgIds.length > 0) {
      const partnerSelect = {
        id: true,
        name: true,
        type: true,
        state: true,
        city: true,
        owner: { select: { id: true, name: true, email: true } },
      } as const;

      // Source 1: connection-linked Partners.
      const partnerConnections = await prisma.networkConnection.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { initiatorOrgId: { in: connectedOrgIds } },
            { receiverOrgId: { in: connectedOrgIds } },
          ],
        },
        include: { initiator: { select: partnerSelect }, reciever: { select: partnerSelect } },
      });

      // Source 2: Partners sharing an Agreement or an Order with a connected organization.
      const [agreementLinks, orderLinks] = await Promise.all([
        prisma.agreement.findMany({
          where: {
            OR: [
              { parentOrgId: { in: connectedOrgIds } },
              { childOrgId: { in: connectedOrgIds } },
            ],
          },
          select: {
            parentOrgId: true,
            childOrgId: true,
            parentOrg: { select: partnerSelect },
            childOrg: { select: partnerSelect },
          },
        }),
        prisma.order.findMany({
          where: {
            OR: [
              { parentOrgId: { in: connectedOrgIds } },
              { childOrgId: { in: connectedOrgIds } },
            ],
          },
          select: {
            parentOrgId: true,
            childOrgId: true,
            parentOrg: { select: partnerSelect },
            childOrg: { select: partnerSelect },
          },
        }),
      ]);

      const links = [
        ...partnerConnections.map((connection) => ({
          aId: connection.initiatorOrgId,
          bId: connection.receiverOrgId,
          a: connection.initiator,
          b: connection.reciever,
        })),
        ...agreementLinks.map((row) => ({ aId: row.parentOrgId, bId: row.childOrgId, a: row.parentOrg, b: row.childOrg })),
        ...orderLinks.map((row) => ({ aId: row.parentOrgId, bId: row.childOrgId, a: row.parentOrg, b: row.childOrg })),
      ];

      for (const link of links) {
        // One end must be an organization in this Company's network; the other end is then
        // the candidate, and only a genuine PARTNER is reported.
        for (const [anchorId, anchor, candidate] of [
          [link.aId, link.a, link.b],
          [link.bId, link.b, link.a],
        ] as const) {
          if (!connectedOrgIds.includes(anchorId)) continue;
          if (anchor.type !== "DISTRIBUTOR") continue;
          if (candidate.type !== "PARTNER" || candidate.id === companyOrgId) continue;
          const list = partnersByDistributor.get(anchorId) ?? [];
          if (!list.some((partner) => partner.id === candidate.id)) list.push(candidate);
          partnersByDistributor.set(anchorId, list);
        }
      }
    }

    const distributors = organizations.map((organization) => ({
      ...organization,
      gstNumber: organization.gstNumber ?? null,
      phone: organization.phone ?? null,
      country: organization.country ?? null,
      isActive: organization.isActive ?? true,
      statusManagementAvailable: availableProfileColumns.has("isActive") && availableProfileColumns.has("accessVersion"),
      partners: partnersByDistributor.get(organization.id) ?? [],
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

/**
 * List Partners connected to the current Distributor.
 *
 * The Distributor must be the active network initiator and the other end must
 * be a PARTNER. This keeps the response limited to the caller's own downstream
 * network and avoids exposing unrelated Partners from other organizations.
 */
export const getPartners = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.membership!.organizationId;
  const connections = await prisma.networkConnection.findMany({
    where: {
      initiatorOrgId: organizationId,
      status: "ACTIVE",
      reciever: { type: "PARTNER" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      reciever: {
        select: {
          id: true,
          name: true,
          type: true,
          state: true,
          city: true,
          pincode: true,
          address: true,
          owner: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      agreements: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { status: true },
      },
    },
  });

  res.json(
    new ApiResponse(
      200,
      {
        partners: connections.map((connection) => ({
          ...connection.reciever,
          connectionId: connection.id,
          connectedAt: connection.createdAt,
          agreementStatus: connection.agreements[0]?.status ?? null,
        })),
      },
      "Partners fetched successfully",
    ),
  );
});
