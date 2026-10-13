// Read-only probe: which schema pieces the orders/requests code needs, and whether the
// configured database actually has them.
//
//   node -r ./audits/auth-registration/runtime-loader.cjs audits/orders/db-schema-probe.ts
//
// Answers "is the orders/requests code able to run against this database at all" without
// writing anything: information_schema lookups plus the exact select shapes the controllers
// use, so a missing column shows up as the error the API would return.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const { prisma } = await import('../../apps/api/src/utils/db');

function target() {
  const url = new URL(process.env.DIRECT_URL || process.env.DATABASE_URL || '');
  return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
}

console.log(`database: ${target()}`);

const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name = 'Order' AND column_name = 'requestedModel')
      OR (table_name = 'User'  AND column_name = 'contact')
      OR (table_name = 'NetworkConnection' AND column_name = 'deletedAt'))
  ORDER BY table_name, column_name`;
console.log(`present columns: ${columns.length ? columns.map((c) => `${c.table_name}.${c.column_name}`).join(', ') : 'none of the probed ones'}`);

const tables = await prisma.$queryRaw<{ table_name: string }[]>`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('KioskReturnRequest', 'OrderSequence', 'EmailDelivery')
  ORDER BY table_name`;
console.log(`present tables: ${tables.length ? tables.map((t) => t.table_name).join(', ') : 'none of the probed ones'}`);

const enums = await prisma.$queryRaw<{ typname: string; enumlabel: string }[]>`
  SELECT t.typname, e.enumlabel FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname IN ('KioskStatus', 'RequestReturnStatus')
  ORDER BY t.typname, e.enumsortorder`;
for (const [name, labels] of Object.entries(
  enums.reduce<Record<string, string[]>>((acc, row) => {
    (acc[row.typname] ??= []).push(row.enumlabel);
    return acc;
  }, {}),
)) {
  console.log(`enum ${name}: ${labels.join(', ')}`);
}

// The select shapes the order/request controllers use. A missing column surfaces as P2022.
const probes: [string, () => Promise<unknown>][] = [
  ['order.requestedModel (request create + approve reserve)', () => prisma.order.findFirst({ select: { id: true, requestedModel: true } })],
  ['order groupBy requestedModel (pending-by-model)', () => prisma.order.groupBy({ by: ['requestedModel'], where: { requestedModel: { not: null } }, _sum: { quantity: true } })],
  ['user.contact (owner registration)', () => prisma.user.findFirst({ select: { id: true, contact: true } })],
  ['kioskReturnRequest (return requests)', () => prisma.kioskReturnRequest.findFirst({ select: { id: true } })],
  ['orderSequence (order numbering)', () => prisma.orderSequence.findFirst({ select: { id: true, value: true } })],
  ['emailDelivery (queued mail)', () => prisma.emailDelivery.findFirst({ select: { id: true } })],
];

for (const [label, run] of probes) {
  try {
    await run();
    console.log(`OK        ${label}`);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(`FAILED    ${label} -> ${e.code ?? 'error'}: ${(e.message ?? '').split('\n').slice(0, 2).join(' ').slice(0, 200)}`);
  }
}

await prisma.$disconnect();
