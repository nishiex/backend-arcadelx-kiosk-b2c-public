
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
});
