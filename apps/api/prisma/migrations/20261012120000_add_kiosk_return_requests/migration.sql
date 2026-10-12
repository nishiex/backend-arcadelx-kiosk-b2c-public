-- Additive migration for the selectively ported Backend-branch features.
-- Timestamped after 20261008120000_remove_request_rejection so it lands last on the
-- existing Merge timeline. This file has NOT been applied to any database.
--
-- Deliberately does NOT drop the RETIRED enum value: the merged frontend lists
-- RETIRED as a real kiosk status (components/dashboard/ui.tsx,
-- components/kiosks/KioskDetailDialog.tsx, lib/backend-api.ts). RETURN_REQUESTED is
-- added alongside it, so the status set is the union of both branches.

-- AlterEnum
-- PostgreSQL allows adding an enum value inside a transaction (PG 12+), but the new
-- value cannot be *used* in the same transaction. The statements below only add the
-- value; the new table uses the separate ReturnRequestStatus enum, so nothing here
-- references RETURN_REQUESTED in this transaction.
ALTER TYPE "KioskStatus" ADD VALUE 'RETURN_REQUESTED';

-- CreateEnum
CREATE TYPE "ReturnRequestStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateTable
CREATE TABLE "KioskReturnRequest" (
    "id" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ReturnRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KioskReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskReturnRequest_kioskId_status_idx" ON "KioskReturnRequest"("kioskId", "status");

-- AddForeignKey
ALTER TABLE "KioskReturnRequest" ADD CONSTRAINT "KioskReturnRequest_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskReturnRequest" ADD CONSTRAINT "KioskReturnRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskReturnRequest" ADD CONSTRAINT "KioskReturnRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
