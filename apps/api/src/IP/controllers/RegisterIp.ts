import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../../utils/db';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiResponse } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import { sendOrganizationCredentialsEmail } from '../../services/email/auth.email';
import '../../middlewares/auth';

const db = prisma as any;

/**
 * Validation Schemas for IP Onboarding
 */
export const RegisterIpSchema = z.object({
  orgName: z.string().trim().min(2, 'Organization name must be at least 2 characters').max(100),
  ownerName: z.string().trim().min(2, 'Owner name must be at least 2 characters').max(100),
  ownerEmail: z.string().trim().toLowerCase().email('Please enter a valid email address').max(254),
  ownerContact: z.string().regex(/^\d{10}$/, 'Owner contact must be a 10-digit number'),
  address: z.string().trim().min(5, 'Address must be at least 5 characters').max(300),
  city: z.string().trim().min(2, 'City must be at least 2 characters').max(100),
  state: z.string().trim().min(2, 'State must be at least 2 characters').max(100),
  pincode: z.number().int('Pincode must be a whole number').min(100000, 'Invalid pincode').max(999999, 'Invalid pincode'),

  // Business & Tax Details
  legalName: z.string().trim().min(2, 'Legal name must be at least 2 characters').max(150).optional(),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F)'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format')
    .optional()
    .or(z.literal('')),
  statementEmail: z.string().trim().toLowerCase().email('Please enter a valid statement email').optional().or(z.literal('')),

  // IP Commercials
  sourceKey: z
    .string()
    .trim()
    .min(2, 'Source key must be at least 2 characters')
    .max(50, 'Source key cannot exceed 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Source key can only contain alphanumeric characters, hyphens, and underscores'),
  ipSharePct: z
    .number()
    .min(0, 'IP share percentage cannot be negative')
    .max(100, 'IP share percentage cannot exceed 100'),
  effectiveFrom: z.string().optional(),
});

export const ChangeIpPercentageSchema = z.object({
  ipSharePct: z
    .number()
    .min(0, 'IP share percentage cannot be negative')
    .max(100, 'IP share percentage cannot exceed 100'),
  effectiveFrom: z.string().optional(),
});

/* Normalizes a source key into a consistent slug (lowercase alphanumeric with hyphens). */
export const normalizeSourceKey = (key: string): string => {
  return key.trim().toLowerCase().replace(/[\s_]+/g, '-');
};

/* Single Database Transaction IP Party Registration.*/
export const registerIpParty = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization is authorized to register IP Parties');
  }

  const validatedData = RegisterIpSchema.parse(req.body);
  const normalizedKey = normalizeSourceKey(validatedData.sourceKey);

  if (normalizedKey === 'nilee-games') {
    throw new ApiError(400, "Source key 'nilee-games' is reserved for in-house company games");
  }

  // 1. Check existing email uniqueness
  const existingUserByEmail = await prisma.user.findUnique({
    where: { email: validatedData.ownerEmail },
  });
  if (existingUserByEmail) {
    throw new ApiError(409, 'User with this email already exists');
  }

  // 2. Check existing contact uniqueness
  const existingUserByContact = await prisma.user.findUnique({
    where: { contact: validatedData.ownerContact },
  });
  if (existingUserByContact) {
    throw new ApiError(409, 'User with this contact number already exists');
  }

  // 3. Check existing sourceKey uniqueness
  const existingProfileBySource = await db.ipProfile.findUnique({
    where: { sourceKey: normalizedKey },
  });
  if (existingProfileBySource) {
    throw new ApiError(409, `IP party with source key '${normalizedKey}' already exists`);
  }

  // 4. Generate cryptographically secure temporary password
  const temporaryPassword = crypto.randomBytes(8).toString('base64url');
  const passwordHash = await bcrypt.hash(temporaryPassword, 10);

  const effectiveStartDate = validatedData.effectiveFrom
    ? new Date(validatedData.effectiveFrom)
    : new Date();

  if (isNaN(effectiveStartDate.getTime())) {
    throw new ApiError(400, 'Invalid effectiveFrom date');
  }

  const ipSharePct = Number(validatedData.ipSharePct);
  const companySharePct = Number((100 - ipSharePct).toFixed(2));
  const cleanGstin = validatedData.gstin && validatedData.gstin.trim() !== '' ? validatedData.gstin.trim() : null;
  const cleanStatementEmail =
    validatedData.statementEmail && validatedData.statementEmail.trim() !== ''
      ? validatedData.statementEmail.trim()
      : null;
  const legalName = validatedData.legalName && validatedData.legalName.trim() !== ''
    ? validatedData.legalName.trim()
    : validatedData.orgName;

  // 5. ATOMIC DATABASE TRANSACTION
  // Creates Organization, Owner User, Membership, IpProfile, and active IpAgreement together
  const { user, org, profile, agreement } = await prisma.$transaction(async (tx) => {
    // A. Create Owner User with mustChangePassword = true
    const newUser = await (tx as any).user.create({
      data: {
        name: validatedData.ownerName,
        email: validatedData.ownerEmail,
        passwordHash,
        contact: validatedData.ownerContact,
        mustChangePassword: true,
      },
    });

    // B. Create Organization with type IP_PARTY
    const newOrg = await (tx as any).organization.create({
      data: {
        name: validatedData.orgName,
        type: 'IP_PARTY',
        state: validatedData.state,
        city: validatedData.city,
        pincode: validatedData.pincode,
        address: validatedData.address,
        gstNumber: cleanGstin,
        ownerId: newUser.id,
      },
    });

    // C. Create Active OWNER Membership
    await (tx as any).membership.create({
      data: {
        userId: newUser.id,
        organizationId: newOrg.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });

    // D. Create IP Profile
    const newProfile = await (tx as any).ipProfile.create({
      data: {
        organizationId: newOrg.id,
        sourceKey: normalizedKey,
        legalName,
        pan: validatedData.pan.toUpperCase(),
        gstin: cleanGstin,
        statementEmail: cleanStatementEmail,
      },
    });

    // E. Create Active IP Agreement (No NetworkConnection dependency)
    const newAgreement = await (tx as any).ipAgreement.create({
      data: {
        organizationId: newOrg.id,
        companyOrganizationId: currentOrgId,
        ipSharePct,
        companySharePct,
        effectiveFrom: effectiveStartDate,
        effectiveTo: null,
        status: 'ACTIVE',
      },
    });

    return {
      user: newUser,
      org: newOrg,
      profile: newProfile,
      agreement: newAgreement,
    };
  });

  // 6. Send Credential Email strictly AFTER database transaction commits
  try {
    await sendOrganizationCredentialsEmail({
      email: user.email,
      name: user.name,
      organizationName: org.name,
      organizationType: 'IP Party',
      temporaryPassword,
    });
  } catch (emailErr) {
    console.error(`[IP Registration] Warning: Credential email failed to deliver to ${user.email}:`, emailErr);
    // Email delivery failure does not roll back the committed records
  }

  res.status(201).json(
    new ApiResponse(
      201,
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
          contact: user.contact,
          mustChangePassword: (user as any).mustChangePassword,
        },
        ipProfile: {
          id: profile.id,
          sourceKey: profile.sourceKey,
          legalName: profile.legalName,
          pan: profile.pan,
          gstin: profile.gstin,
          statementEmail: profile.statementEmail,
        },
        agreement: {
          id: agreement.id,
          ipSharePct: Number(agreement.ipSharePct),
          companySharePct: Number(agreement.companySharePct),
          effectiveFrom: agreement.effectiveFrom,
          status: agreement.status,
        },
      },
      'IP Party registered successfully. Credentials sent to owner.'
    )
  );
});

/**
 * Changes an IP Party's royalty percentage.
 * Atomically terminates the previous agreement and creates the new active agreement.
 */
export const changeIpPercentage = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentCompanyOrgId = req.membership?.organizationId;
  if (currentOrgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization can modify IP commercial percentages');
  }

  const { ipOrgId } = req.params;
  const targetOrgId = ipOrgId || req.params.organizationId;

  if (!targetOrgId || typeof targetOrgId !== 'string') {
    throw new ApiError(400, 'Invalid IP organization ID');
  }

  // 1. Verify organization exists and is an IP_PARTY
  const ipOrg = await prisma.organization.findUnique({
    where: { id: targetOrgId },
    select: { id: true, name: true, type: true },
  });

  if (!ipOrg || (ipOrg.type as any) !== 'IP_PARTY') {
    throw new ApiError(404, 'IP Party organization not found');
  }

  const { ipSharePct, effectiveFrom } = ChangeIpPercentageSchema.parse(req.body);
  const newEffectiveFrom = effectiveFrom ? new Date(effectiveFrom) : new Date();

  if (isNaN(newEffectiveFrom.getTime())) {
    throw new ApiError(400, 'Invalid effectiveFrom timestamp');
  }

  // 2. Find existing active agreement
  const activeAgreement = await db.ipAgreement.findFirst({
    where: {
      organizationId: targetOrgId,
      status: 'ACTIVE',
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (!activeAgreement) {
    throw new ApiError(404, 'No active IP agreement found for this organization');
  }

  // Validate non-overlapping effective period
  if (newEffectiveFrom < activeAgreement.effectiveFrom) {
    throw new ApiError(
      400,
      `New effective start date (${newEffectiveFrom.toISOString()}) cannot precede the current agreement start date (${activeAgreement.effectiveFrom.toISOString()})`
    );
  }

  const newCompanySharePct = Number((100 - ipSharePct).toFixed(2));

  // 3. ATOMIC TRANSACTION: Terminate old agreement & activate new agreement
  const newAgreement = await prisma.$transaction(async (tx) => {
    // Terminate old agreement
    await (tx as any).ipAgreement.update({
      where: { id: activeAgreement.id },
      data: {
        status: 'TERMINATED',
        effectiveTo: newEffectiveFrom,
      },
    });

    // Create new active agreement
    const created = await (tx as any).ipAgreement.create({
      data: {
        organizationId: targetOrgId,
        companyOrganizationId: currentCompanyOrgId || activeAgreement.companyOrganizationId,
        ipSharePct,
        companySharePct: newCompanySharePct,
        effectiveFrom: newEffectiveFrom,
        effectiveTo: null,
        status: 'ACTIVE',
      },
    });

    return created;
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        previousAgreementId: activeAgreement.id,
        newAgreement: {
          id: newAgreement.id,
          organizationId: newAgreement.organizationId,
          ipSharePct: Number(newAgreement.ipSharePct),
          companySharePct: Number(newAgreement.companySharePct),
          effectiveFrom: newAgreement.effectiveFrom,
          status: newAgreement.status,
        },
      },
      'IP agreement percentage updated successfully'
    )
  );
});

/**
 * Company Dashboard: List all registered IP Parties.
 */
export const getIpParties = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  if (currentOrgType !== 'COMPANY') {
    throw new ApiError(403, 'Unauthorized');
  }

  const parties = await db.organization.findMany({
    where: { type: 'IP_PARTY' },
    select: {
      id: true,
      name: true,
      city: true,
      state: true,
      createdAt: true,
      owner: {
        select: {
          id: true,
          name: true,
          email: true,
          contact: true,
        },
      },
      ipProfile: {
        select: {
          id: true,
          sourceKey: true,
          legalName: true,
          pan: true,
          gstin: true,
          statementEmail: true,
        },
      },
      ipAgreements: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          ipSharePct: true,
          companySharePct: true,
          effectiveFrom: true,
          status: true,
        },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json(new ApiResponse(200, { parties }, 'IP Parties fetched successfully'));
});
