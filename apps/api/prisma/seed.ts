// One-time company setup. Runtime pages read database records through the API.
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Works through Prisma CLI or directly, regardless of the current directory.
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

class SeedError extends Error {}
const fields = z.object({
  SEED_OWNER_NAME: z.string().trim().min(2).max(100),
  SEED_OWNER_EMAIL: z.string().trim().toLowerCase().email().max(254),
  // bcrypt supports at most 72 bytes; reject silent password truncation.
  SEED_OWNER_PASSWORD: z.string().min(8).refine(value => Buffer.byteLength(value, 'utf8') <= 72),
  SEED_COMPANY_NAME: z.string().trim().min(2).max(100),
  SEED_COMPANY_STATE: z.string().trim().min(2).max(100),
  SEED_COMPANY_CITY: z.string().trim().min(2).max(100),
  SEED_COMPANY_PINCODE: z.coerce.number().int().min(100000).max(999999),
  SEED_COMPANY_ADDRESS: z.string().trim().min(5).max(300),
});

async function main() {
  if (!process.env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\//)) {
    throw new SeedError('A PostgreSQL DATABASE_URL is required.');
  }
  const { prisma } = await import('../src/utils/db');
  const checkOnly = process.argv.includes('--check');
  try {
    const result = await prisma.$transaction(async tx => {
      if (checkOnly) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      // Serialize concurrent bootstrap runs without replacing any existing data.
      else await tx.$executeRaw`SELECT pg_advisory_xact_lock(742080001)`;

      const company = await tx.organization.findFirst({
        where: { type: 'COMPANY' },
        // Older databases can lack profile/access columns. Do not select them.
        select: { id: true, ownerId: true },
      });
      if (company) {
        const membership = await tx.membership.findUnique({
          where: { userId: company.ownerId },
          select: { organizationId: true, role: true, status: true },
        });
        if (membership?.organizationId !== company.id || membership.role !== 'OWNER' || membership.status !== 'ACTIVE') {
          throw new SeedError('Existing company owner membership is inconsistent. Repair it explicitly; seed will not overwrite accounts.');
        }
        return { created: false, companyId: company.id };
      }
      if (checkOnly) throw new SeedError('No company is stored in this database. Configure SEED_* values and run the seed to initialize it.');

      const parsed = fields.safeParse(process.env);
      if (!parsed.success) {
        const names = [...new Set(parsed.error.issues.map(issue => issue.path[0]))];
        throw new SeedError(`Missing or invalid setup variables: ${names.join(', ')}. See .env.example. No records were written.`);
      }
      const values = parsed.data;
      // Prisma supplies these schema defaults on inserts, even when omitted here.
      const accessColumns = await tx.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Organization'
          AND column_name IN ('isActive', 'accessVersion')`;
      if (accessColumns.length !== 2) {
        throw new SeedError('New company setup requires the organization access-status migration. Apply the reviewed migrations before seeding; no records were written.');
      }
      if (await tx.user.findUnique({ where: { email: values.SEED_OWNER_EMAIL }, select: { id: true } })) {
        throw new SeedError('The configured owner email already belongs to an account. Seed will not replace or take over that account.');
      }
      const user = await tx.user.create({
        data: {
          name: values.SEED_OWNER_NAME,
          email: values.SEED_OWNER_EMAIL,
          passwordHash: await bcrypt.hash(values.SEED_OWNER_PASSWORD, 12),
        },
        select: { id: true },
      });
      const organization = await tx.organization.create({
        data: {
          name: values.SEED_COMPANY_NAME, type: 'COMPANY', ownerId: user.id,
          state: values.SEED_COMPANY_STATE, city: values.SEED_COMPANY_CITY,
          pincode: values.SEED_COMPANY_PINCODE, address: values.SEED_COMPANY_ADDRESS,
        },
        select: { id: true },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER', status: 'ACTIVE' },
        select: { id: true },
      });
      return { created: true, companyId: organization.id };
    }, { maxWait: 15000, timeout: 30000 });
    console.log(result.created
      ? 'Company, owner and active Owner membership saved to the database.'
      : 'Existing company and active Owner membership verified. No records changed.');
    console.log('Company ID:', result.companyId);
    // Never print the password or stored password hash.
  } finally { await prisma.$disconnect(); }
}

main().catch((error: unknown) => {
  if (error instanceof SeedError) console.error(error.message);
  else {
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? ` (${error.code})` : '';
    console.error(`Seed failed${code}. Check database connectivity, schema and database constraints.`);
  }
  process.exitCode = 1;
});
