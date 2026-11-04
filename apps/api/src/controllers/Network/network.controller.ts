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
  // Inventory is safe to expose to the two sides that manage the relationship:
  // the Company Owner (Master Admin) and the Distributor. The query is still
  // restricted to organizations in this user's network below.
  const canViewNetworkInventory =
    (req.membership!.type === "COMPANY" && req.membership!.role === "OWNER") ||
    req.membership!.type === "DISTRIBUTOR";
  const where = { OR: [{ initiatorOrgId: organizationId }, { receiverOrgId: organizationId }] };
  const org = { select: { id: true, name: true, type: true } } as const;
  const orgWithInventory = {
    select: {
      id: true,
      name: true,
      type: true,
      kiosks: {
        select: { machineCode: true, model: true },
        orderBy: { machineCode: "asc" as const },
      },
    },
  } as const;
  const initiator = canViewNetworkInventory ? orgWithInventory : org;
  const reciever = canViewNetworkInventory ? orgWithInventory : org;
  const [total, requests] = await prisma.$transaction([
    prisma.networkConnection.count({ where }),
    prisma.networkConnection.findMany({ where, skip: (page - 1) * limit, take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { initiator, reciever } }),
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
    // A Partner sees the one Distributor it trades with, not the whole distributor list.
    let distributorWhere: { type: "DISTRIBUTOR"; id?: string } = { type: "DISTRIBUTOR" };
    if (req.membership!.type === "PARTNER") {
      const self = await prisma.organization.findUnique({
        where: { id: req.membership!.organizationId },
        select: { parentOrgId: true },
      });
      if (!self?.parentOrgId) throw new ApiError(404, "No Distributor is linked to this Partner");
      distributorWhere = { type: "DISTRIBUTOR", id: self.parentOrgId };
    }
    const organizations = await prisma.organization.findMany({
      where: distributorWhere,
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

    const latestAgreements = await prisma.agreement.findMany({
      where: { childOrgId: { in: organizations.map((organization) => organization.id) } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { childOrgId: true, status: true },
    });
    const agreementStatusByDistributor = new Map<string, string>();
    for (const agreement of latestAgreements) {
      if (!agreementStatusByDistributor.has(agreement.childOrgId)) {
        agreementStatusByDistributor.set(agreement.childOrgId, agreement.status);
      }
    }

    // Partners genuinely associated with each Distributor, reachable from this Company.
    // Registration now records the parent organization directly. Network connections,
    // agreements and orders remain as legacy association sources for older rows.
    //
    //   1. an ACTIVE NetworkConnection between a Distributor and the Partner, where the
    //      Distributor is one this Company is connected to, or
    //   2. an Agreement/Order between that Distributor and the Partner.
    //
    // This endpoint already exposes every Distributor in the single-company
    // deployment, so that same visible Distributor set is the boundary for child
    // Partner details. A separate Company↔Distributor connection is not required
    // merely to display a Partner registered under a visible Distributor.
    const visibleDistributorIds = organizations.map((organization) => organization.id);

    const partnersByDistributor = new Map<
      string,
      { id: string; name: string; type: string; state: string | null; city: string | null; owner: { id: string; name: string; email: string } | null; agreementStatus: string | null }[]
    >();

    if (visibleDistributorIds.length > 0) {
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
            { initiatorOrgId: { in: visibleDistributorIds } },
            { receiverOrgId: { in: visibleDistributorIds } },
          ],
        },
        include: { initiator: { select: partnerSelect }, reciever: { select: partnerSelect } },
      });

      const registeredPartners = await prisma.organization.findMany({
        where: { parentOrgId: { in: visibleDistributorIds }, type: "PARTNER" },
        select: { ...partnerSelect, parentOrgId: true },
      });

      // Source 2: Partners sharing an Agreement or an Order with a connected organization.
      const [agreementLinks, orderLinks] = await Promise.all([
        prisma.agreement.findMany({
          where: {
            OR: [
              { parentOrgId: { in: visibleDistributorIds } },
              { childOrgId: { in: visibleDistributorIds } },
            ],
          },
          select: {
            parentOrgId: true,
            childOrgId: true,
            status: true,
            createdAt: true,
            id: true,
            parentOrg: { select: partnerSelect },
            childOrg: { select: partnerSelect },
          },
        }),
        prisma.order.findMany({
          where: {
            OR: [
              { parentOrgId: { in: visibleDistributorIds } },
              { childOrgId: { in: visibleDistributorIds } },
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

      const agreementStatusByPartner = new Map<string, string>();
      for (const agreement of [...agreementLinks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))) {
        const distributorId = agreement.parentOrg.type === "DISTRIBUTOR" ? agreement.parentOrgId : agreement.childOrgId;
        const partnerId = agreement.parentOrg.type === "PARTNER" ? agreement.parentOrgId : agreement.childOrgId;
        if (visibleDistributorIds.includes(distributorId) && agreement.parentOrg.type !== agreement.childOrg.type) {
          const key = `${distributorId}:${partnerId}`;
          if (!agreementStatusByPartner.has(key)) agreementStatusByPartner.set(key, agreement.status);
        }
      }

      const links = [
        ...registeredPartners.map((partner) => ({
          aId: partner.parentOrgId!,
          bId: partner.id,
          a: organizations.find((organization) => organization.id === partner.parentOrgId)!,
          b: partner,
        })),
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
          if (!visibleDistributorIds.includes(anchorId)) continue;
          if (anchor.type !== "DISTRIBUTOR") continue;
          if (candidate.type !== "PARTNER" || candidate.id === companyOrgId) continue;
          const list = partnersByDistributor.get(anchorId) ?? [];
          if (!list.some((partner) => partner.id === candidate.id)) {
            list.push({ ...candidate, agreementStatus: agreementStatusByPartner.get(`${anchorId}:${candidate.id}`) ?? null });
          }
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
      agreementStatus: agreementStatusByDistributor.get(organization.id) ?? null,
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
 * Partners registered by the Distributor are visible immediately. Active network
 * connections are merged in as well so legacy registrations and agreement flows
 * continue to work without exposing another Distributor's children.
 */
export const getPartners = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.membership!.organizationId;
  const partnerSelect = {
    id: true,
    name: true,
    type: true,
    state: true,
    city: true,
    pincode: true,
    address: true,
    createdAt: true,
    owner: { select: { id: true, name: true, email: true } },
  } as const;
  const [connections, registeredPartners, activeRegisteredPartnerAgreements] = await Promise.all([
    prisma.networkConnection.findMany({
      where: {
        initiatorOrgId: organizationId,
        status: "ACTIVE",
        reciever: { type: "PARTNER" },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        reciever: { select: partnerSelect },
        agreements: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { status: true },
        },
      },
    }),
    prisma.organization.findMany({
      where: { parentOrgId: organizationId, type: "PARTNER" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: partnerSelect,
    }),
    // A Partner created directly by a Distributor does not necessarily have a
    // NetworkConnection row in older data. Its allocation eligibility is still
    // determined by the same active parent/child agreement as createOrder.
    prisma.agreement.findMany({
      where: {
        parentOrgId: organizationId,
        status: "ACTIVE",
        childOrg: { is: { type: "PARTNER" } },
      },
      select: { childOrgId: true },
    }),
  ]);
  const activeRegisteredPartnerIds = new Set(
    activeRegisteredPartnerAgreements.map((agreement) => agreement.childOrgId),
  );

  const partners = new Map<string, {
    id: string;
    name: string;
    type: string;
    state: string;
    city: string;
    pincode: number;
    address: string;
    createdAt: Date;
    owner: { id: string; name: string; email: string } | null;
    connectionId: string | null;
    connectedAt: Date | null;
    agreementStatus: string | null;
  }>();
  for (const connection of connections) {
    partners.set(connection.reciever.id, {
      ...connection.reciever,
      connectionId: connection.id,
      connectedAt: connection.createdAt,
      agreementStatus: connection.agreements[0]?.status ?? null,
    });
  }
  for (const partner of registeredPartners) {
    if (!partners.has(partner.id)) {
      partners.set(partner.id, {
        ...partner,
        connectionId: null,
        connectedAt: null,
        agreementStatus: activeRegisteredPartnerIds.has(partner.id) ? "ACTIVE" : null,
      });
    }
  }

  res.json(
    new ApiResponse(
      200,
      {
        partners: [...partners.values()],
      },
      "Partners fetched successfully",
    ),
  );
});
