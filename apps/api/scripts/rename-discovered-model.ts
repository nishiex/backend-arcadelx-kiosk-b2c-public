// Rename the placeholder model that the device sync used to write ("Unassigned")
// to the real model name. Idempotent: re-running it updates nothing.
// Run: npx tsx scripts/rename-discovered-model.ts
//
// The env file has to be loaded BEFORE the Prisma module is imported: db.ts builds
// its pool from process.env.DATABASE_URL at module load, and static imports are
// hoisted above any top-level dotenv.config() call.
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const { prisma } = await import('../src/utils/db');

const FROM = 'Unassigned';
const TO = 'ArcadeLX';

const matchedBefore = await prisma.kiosk.count({ where: { model: FROM } });
const result = await prisma.kiosk.updateMany({ where: { model: FROM }, data: { model: TO } });
const remaining = await prisma.kiosk.count({ where: { model: FROM } });
const nowAtTarget = await prisma.kiosk.count({ where: { model: TO } });

console.log(JSON.stringify({ matchedBefore, updated: result.count, remaining, nowAtTarget }, null, 2));
await prisma.$disconnect();
