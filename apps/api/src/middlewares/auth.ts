import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/db";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";
import { getUserOrganizationAccess, assertOrganizationActive } from "../services/organization-access";
import { clearTokenCookies } from "../utils/token";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };

      membership?: {
        organizationId: string;
        role: string;
        type: string;
      };
    }
  }
}

const ACCESS_SECRET_TOKEN = process.env.ACCESS_SECRET_TOKEN!;

type AccessTokenPayload = {
  id: string;
  organizationAccessVersion?: number;
};

export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => 
 {
    const token = req.cookies.access_token;

    if (!token) throw new ApiError(401, "Unauthorized request");

    let decoded: AccessTokenPayload;
    try {
      decoded = jwt.verify(token,ACCESS_SECRET_TOKEN) as AccessTokenPayload;
    } catch {
      throw new ApiError( 401,"Invalid or expired access token");
    }
    const access = await getUserOrganizationAccess(decoded.id);
    try {
      assertOrganizationActive(access);
      if (access?.type === "DISTRIBUTOR" && (decoded.organizationAccessVersion ?? 0) !== access.accessVersion) {
        throw new ApiError(401, "Your session has ended. Please log in again.");
      }
    } catch (error) {
      clearTokenCookies(res);
      throw error;
    }
    req.user = { id: decoded.id };
    next();
  }
);

export const loadMembership = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const membership = await prisma.membership.findUnique({
      where: {
        userId: req.user!.id,
      },
      include: {
        organization: {
          select: {
            type: true,
          },
        },
      },
    });

    if (!membership || membership.status !== "ACTIVE" ||!membership.role) throw new ApiError(403, "You do not have active access to an organization");

    // Accounts issued a temporary password (IP parties) must replace it first. /change-password
    // and /me are mounted with requireAuth only, so they stay reachable.
    const account = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { mustChangePassword: true },
    });
    if (account?.mustChangePassword) {
      throw new ApiError(
        403,
        "Password change required. You must change your temporary password before accessing the system.",
        { mustChangePassword: true },
      );
    }

    req.membership = {
      organizationId: membership.organizationId,
      role: membership.role,
      type: membership.organization.type,
    };

    next();
  }
);

export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if ( !req.membership || !allowedRoles.includes(req.membership.role)) throw new ApiError(403, "Insufficient permissions");

    next();
  };
};

export const requireOrgType = (...allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.membership || !allowedTypes.includes(req.membership.type) ) throw new ApiError( 403,"Organization type not authorized for this action");
    
    next();
  };
};

/*Allowed Logic, COMPANY ->DISTRIBUTOR
                         ->PARTNER
                  DISTRIBUTOR->PARTNER

                        */
export const requireCanCreateOrganization = (req: Request,res: Response,next: NextFunction) => {
  if (!req.membership) throw new ApiError(403, "Organization membership required");

  if (req.membership.type !== "COMPANY" && req.membership.type !== "DISTRIBUTOR") throw new ApiError(403,"Your organization cannot create other organizations");

  next();
};
