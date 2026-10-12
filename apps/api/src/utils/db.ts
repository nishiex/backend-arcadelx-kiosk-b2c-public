
//Creates a single, reusable Prisma client instance so we don't exhaust 
// Supabase connections by opening a new one on every request.
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

export const prisma = new PrismaClient({
  adapter,
  // Contact is only selected explicitly where needed. Routine auth and nested
  // user responses also remain compatible before the contact migration deploys.
  omit: { user: { contact: true } },
  // Prisma's defaults (maxWait 2s, timeout 5s) assume a local database. The hosted
  // pooler answers a round-trip in ~380ms versus ~6ms locally, so an order transaction
  // issuing a handful of sequential queries exceeded 5s and failed to commit:
  //     PATCH /api/orders/:id/deliver -> 500
  //     "A commit cannot be executed on an expired transaction"
  // These match the values prisma/seed.ts already passes for its long transaction. The
  // timeout does not make the work faster; it stops a slow-but-correct transaction from
  // being rolled back purely on wall-clock time.
  transactionOptions: {
    maxWait: 15000,
    timeout: 30000,
  },
});
