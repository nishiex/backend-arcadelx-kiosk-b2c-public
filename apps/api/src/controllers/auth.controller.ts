import type { Request,Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../utils/db";
import { asyncHandler } from "../utils/asyncHandler";
import { RegisterOrgSchema, JoinOrgSchema, LoginSchema,ResetPasswordSchema } from '@shared-types/validationSchemas/auth.validation'; // Adjust import based on your monorepo setup
import { generateTokens,hashToken,setTokenCookies } from "../utils/token";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";

/*
On the Frontend side  we only give 3 options
1.RegisterOrg
2.JoinOrg
3.Login 

On selecitng 1 or 2 , Users are registered first and then after that they are taken to the respective work they opt for*/

export const registerOrganization = asyncHandler(
  async (req: Request, res: Response) => {
    const validatedData = RegisterOrgSchema.parse(req.body);

    const parentOrgType = req.membership!.type;

    // Validate what this parent can create

    if (parentOrgType === "COMPANY" && !["DISTRIBUTOR", "PARTNER"].includes(validatedData.orgType)) throw new ApiError(403,"A company can only create Distributor or Partner organizations");
    
    if (
      parentOrgType === "DISTRIBUTOR" &&
      validatedData.orgType !== "PARTNER"
    ) {
      throw new ApiError(
        403,
        "A Distributor can only create Partner organizations"
      );
    }

    if (parentOrgType === "PARTNER") throw new ApiError(403,"A Partner cannot create organizations");
    

    const existingUser = await prisma.user.findUnique({
      where: {
        email: validatedData.ownerEmail,
      },
    });

    if (existingUser) throw new ApiError(409,"User with this email already exists");
    
    // Generate temporary password

    const temporaryPassword = crypto.randomBytes(8).toString("base64url");

    const passwordHash = await bcrypt.hash(temporaryPassword,10);

    // Create owner + organization + membership

    const { user, org } = await prisma.$transaction(async (tx) => {

      const newUser = await tx.user.create({
        data: {
          name: validatedData.ownerName,
          email: validatedData.ownerEmail,
          passwordHash,
        },
      });

      const newOrg = await tx.organization.create({
        data: {
          name: validatedData.orgName,
          type: validatedData.orgType,
          state: validatedData.state,
          city: validatedData.city,
          pincode: validatedData.pincode,
          address: validatedData.address,
          ownerId: newUser.id,
        },
      });

      await tx.membership.create({
        data: {
          userId: newUser.id,
          organizationId: newOrg.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      return {
        user: newUser,
        org: newOrg,
      };
    });

 
    // TODO: Send credentials by email

    // await sendOrganizationCredentialsEmail({
    //   email: user.email,
    //   name: user.name,
    //   organizationName: org.name,
    //   temporaryPassword,
    // });

    // IMPORTANT:
    // Do NOT generate access/refresh tokens here.
    // The parent organization user is already logged in.

    
    // Don't send the temporary password in the API response ,password should go through email service.
    res.status(201).json(new ApiResponse(201,
        {
          organization: {
            id: org.id,
            name: org.name,
            type: org.type,
          },
          owner: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
        },
        "Organization created successfully"
      )
    );
  }
);

//Join Organization(COMPAnY ONLY)
export const joinOrganization = asyncHandler(async(req:Request,res:Response)=>
{
    const validatedData = JoinOrgSchema.parse(req.body);

     const exsitingUser = await prisma.user.findUnique({where: {email:validatedData.email }});
    
    if(exsitingUser)throw new ApiError(409,"User with this email already exists ");
    
    const org = await prisma.organization.findUnique({ where: { inviteCode: validatedData.inviteCode } });

    if (org!.type !== "COMPANY")   throw new ApiError(403,"Only Company organizations accept join requests");

    if (!org) throw new ApiError(404, 'Invalid invite code');
  
    if (org.inviteCodeExpiresAt && org.inviteCodeExpiresAt < new Date()) throw new ApiError(400, 'Invite code has expired');

    //Hash the password entered by the user
    const passwordHash = await bcrypt.hash(validatedData.password,10);

    const user = await prisma.$transaction(async (tx) => {

    const newUser = await tx.user.create({
      data: { name: validatedData.name, email: validatedData.email, passwordHash }
    });

    await tx.membership.create({
      data: { userId: newUser.id, organizationId: org.id, status: 'PENDING' } // No role assigned until approved
    });

    return newUser;
  });
  const { accessToken, refreshToken } = generateTokens(user.id);
  
  await prisma.refreshToken.create({
    data: {
      token: hashToken(refreshToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  setTokenCookies(res, accessToken, refreshToken);

  res.status(201).json(new ApiResponse(201, { user: { id: user.id, email: user.email } }, 'Successfully joined organization. Pending approval.'));
})

//After every login we are rotating the refresh tokens
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = LoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) throw new ApiError(401, 'Invalid email or password');

  const { accessToken, refreshToken } = generateTokens(user.id);

  await prisma.refreshToken.create({
    data: {
      token: hashToken(refreshToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)//7D
    }
  });

  setTokenCookies(res, accessToken, refreshToken);

  res.status(200).json(new ApiResponse(200, { user: { id: user.id, email: user.email } }, 'Login successful'));
});

//Refresh Endpoint
export const refresh = asyncHandler(async (req:Request,res:Response) =>
{
    const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) throw new ApiError(401, "Refresh token missing");

  const hashedToken = hashToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: {
      token: hashedToken,
    },
  });

  if (!storedToken) throw new ApiError(401, "Invalid refresh token");
  

  if (storedToken.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.refreshToken.delete({
      where: {
        id: storedToken.id,
      },
    });

    throw new ApiError(401, "Refresh token expired, Please Login Again");
  }

  // Generate new token pair
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(storedToken.userId);

  // Rotate refresh token atomically
  await prisma.$transaction(async (tx) => {
    // Revoke old refresh token
    await tx.refreshToken.delete({
      where: {
        id: storedToken.id,
      },
    });

    // Store new refresh token
    await tx.refreshToken.create({
      data: {
        token: hashToken(newRefreshToken),
        userId: storedToken.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  });

  // Send new tokens
  setTokenCookies(res, accessToken, newRefreshToken);

  res.status(200).json(new ApiResponse(200,{ accessToken },"Token refreshed successfully"));

});

//Routes for frontend...
export const getMe = asyncHandler(async(req:Request,res:Response)=>
{
    const user = await prisma.user.findUnique(
        {
            where:{
                id:req.user!.id,
            },
              select:
              {
                 id:true,
                 email:true,
                 name:true,
                 membership:
                 {
                    select:
                    {
                        organizationId:true,
                        status: true,
                        role: true,
                        organization: {
                                        select: {
                                            id: true,
                                            name: true,
                                            type: true,
                                        },
                        }
                    }
                 }

              }
        }
    )
    if (!user) throw new ApiError(404, "User not found");


    res.status(200).json(new ApiResponse(200,{ user },"User fetched successfully"));
})

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      email,
      currentPassword,
      newPassword,
    } = ResetPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      throw new ApiError(401, "Invalid email or current password");
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash
    );

    if (!isPasswordValid) {
      throw new ApiError(401, "Invalid email or current password");
    }

    // Prevent using the same password again
    const isSamePassword = await bcrypt.compare(
      newPassword,
      user.passwordHash
    );

    if (isSamePassword) {
      throw new ApiError(
        400,
        "New password must be different from your current password"
      );
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction(async (tx) => {
      // Update password
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          passwordHash: newPasswordHash,
        },
      });

      // Invalidate existing refresh tokens
      await tx.refreshToken.deleteMany({
        where: {
          userId: user.id,
        },
      });
    });

    res.status(200).json(
      new ApiResponse(
        200,
        null,
        "Password reset successfully. Please login again."
      )
    );
  }
);
