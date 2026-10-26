import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const WipeLiveDatabaseSchema = z.object({
  confirmation: z.literal('WIPE LIVE DATABASE'),
});

type PublicTable = { tablename: string };

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

/**
 * Removes application data but deliberately preserves the schema and Prisma's
 * migration ledger. The route is Company-Owner-only and feature-flagged by the
 * router/environment; this handler also requires an explicit typed confirmation.
 */
export const wipeLiveDatabase = asyncHandler(async (req, res) => {
  if (env.DATABASE_WIPE_ENABLED !== 'true') {
    throw new ApiError(403, 'Live database wipe is disabled by server configuration');
  }

  WipeLiveDatabaseSchema.parse(req.body);

  const tableRows = await prisma.$queryRawUnsafe<PublicTable[]>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext('arcadelx-live-database-wipe'))",
    );
    if (tableRows.length) {
      const tables = tableRows.map(({ tablename }) => `public.${quoteIdentifier(tablename)}`).join(', ');
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    }
  });

  res.status(200).json(
    new ApiResponse(200, { tablesCleared: tableRows.length }, 'Live database data was permanently deleted'),
  );
});
