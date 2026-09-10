import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../utils/db";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";

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
};

export const requireAuth = asyncHandler(async (req: Request, res: Response, next: NextFunction) => 
 {
    const token = req.cookies.access_token;

    if (!token) throw new ApiError(401, "Unauthorized request");

    try {
      const decoded = jwt.verify(token,ACCESS_SECRET_TOKEN) as AccessTokenPayload;

      req.user = {
        id: decoded.id,
      };

      next();
    } catch {
      throw new ApiError( 401,"Invalid or expired access token");
    }
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
