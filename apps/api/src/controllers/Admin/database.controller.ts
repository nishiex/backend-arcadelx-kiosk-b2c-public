import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';

const WipeLocalDatabaseSchema = z.object({
  confirmation: z.literal('WIPE LOCAL DATABASE'),
});

type PublicTable = { tablename: string };
const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Local-development-only data reset. Production is rejected at the handler boundary. */
export const wipeLocalDatabase = asyncHandler(async (req, res) => {
  if (env.NODE_ENV !== 'development' || env.LOCAL_DATABASE_WIPE_ENABLED !== 'true') {
    throw new ApiError(403, 'Local database wipe is disabled');
  }

  WipeLocalDatabaseSchema.parse(req.body);
  const tableRows = await prisma.$queryRawUnsafe<PublicTable[]>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename
  `);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('arcadelx-local-database-wipe'))");
    if (tableRows.length) {
      const tables = tableRows.map(({ tablename }) => `public.${quoteIdentifier(tablename)}`).join(', ');
      await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    }
  });

  res.status(200).json(new ApiResponse(200, { tablesCleared: tableRows.length }, 'Local database data was cleared'));
});
