-- Remove the REJECTED state from connection requests and financial agreements.
--
-- Request rejection is not part of the base Backend branch: origin/Backend exposes only
--   POST /api/network/initiate, GET /api/network/requests,
--   POST /api/network/:id/accept, DELETE /api/network/:id
-- for connections, and create/approve/terminate for agreements. The REJECTED values were added
-- on this branch, and the owner asked for the whole feature to go.
--
-- Safety: verified before writing this migration that both databases hold ZERO rows with
-- status = 'REJECTED' in NetworkConnection and Agreement, so the type change cannot invalidate
-- existing data. If such a row did exist, the ALTER TYPE below fails loudly rather than coercing.
--
-- MembershipStatus.REJECTED is deliberately NOT touched: it belongs to join-request rejection
-- (membership.controller.ts writes it), a different feature that stays.
--
-- Postgres cannot remove an enum value in place, so each type is rebuilt: rename the old type,
-- create the replacement, retype the dependent column (including its default), drop the old type.
--
-- Agreement_open_pair_key must be dropped first. It is a PARTIAL index whose predicate embeds the
-- enum -- WHERE status = ANY (ARRAY['PENDING_APPROVAL'::"AgreementStatus", ...]) -- and Postgres
-- refuses to retype a column while an index expression still names the old type:
--     ERROR: operator does not exist: "AgreementStatus" = "AgreementStatus_old"
-- It is recreated afterwards against the new type, preserving the uniqueness guarantee.
--
-- No explicit BEGIN/COMMIT: Prisma already runs each migration in a transaction, and emitting one
-- here commits early and breaks the migration bookkeeping.

-- ---------------------------------------------------------------- NetworkStatus
ALTER TYPE "NetworkStatus" RENAME TO "NetworkStatus_old";
CREATE TYPE "NetworkStatus" AS ENUM ('PENDING', 'ACTIVE');
ALTER TABLE "NetworkConnection" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "NetworkConnection" ALTER COLUMN "status" TYPE "NetworkStatus" USING ("status"::text::"NetworkStatus");
ALTER TABLE "NetworkConnection" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "NetworkStatus_old";

-- ---------------------------------------------------------------- AgreementStatus
DROP INDEX IF EXISTS "Agreement_open_pair_key";

ALTER TYPE "AgreementStatus" RENAME TO "AgreementStatus_old";
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'TERMINATED');
ALTER TABLE "Agreement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Agreement" ALTER COLUMN "status" TYPE "AgreementStatus" USING ("status"::text::"AgreementStatus");
ALTER TABLE "Agreement" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "AgreementStatus_old";

-- Restore the "one open agreement per organization pair" guarantee, now expressed against the
-- new type. This mirrors the original index definition exactly, minus the removed REJECTED value.
CREATE UNIQUE INDEX "Agreement_open_pair_key" ON "Agreement" ("parentOrgId", "childOrgId")
  WHERE "status" = ANY (ARRAY['PENDING_APPROVAL'::"AgreementStatus", 'ACTIVE'::"AgreementStatus"]);
