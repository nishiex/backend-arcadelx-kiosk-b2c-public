-- Additive revenue integration; original remote sources are archived in audits/revenue.
BEGIN;
SET LOCAL lock_timeout='5s';
-- CreateEnum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='SyncStatus') THEN CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED'); END IF; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Transaction" (
    "id" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "externalTransactionId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RevenueSyncRunLog" (
    "id" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalRecordsFetched" INTEGER NOT NULL DEFAULT 0,
    "newRecordsInserted" INTEGER NOT NULL DEFAULT 0,
    "unattributedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "SyncStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevenueSyncRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_externalTransactionId_key" ON "Transaction"("externalTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_kioskId_occurredAt_idx" ON "Transaction"("kioskId", "occurredAt");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"Transaction"'::regclass AND conname='Transaction_kioskId_fkey') THEN ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

-- CreateEnum
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typname='StatementStatus') THEN CREATE TYPE "StatementStatus" AS ENUM ('GENERATED', 'PAID'); END IF; END $$;

-- AlterEnum


-- AlterEnum


-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "gstPercentage" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "pgFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 2.50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "RevenueStatement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "Month" INTEGER NOT NULL,
    "Year" INTEGER NOT NULL,
    "GrossRevenue" DECIMAL(12,2) NOT NULL,
    "netRevenue" DECIMAL(12,2) NOT NULL,
    "companyShare" DECIMAL(12,2) NOT NULL,
    "distributorShare" DECIMAL(12,2) NOT NULL,
    "partnerShare" DECIMAL(12,2) NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'GENERATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RevenueStatement_organizationId_Month_Year_key" ON "RevenueStatement"("organizationId", "Month", "Year");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"RevenueStatement"'::regclass AND conname='RevenueStatement_organizationId_fkey') THEN ALTER TABLE "RevenueStatement" ADD CONSTRAINT "RevenueStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE; END IF; END $$;

/*
  Warnings:

  - Added the required column `finalPayout` to the `RevenueStatement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tdsAmount` to the `RevenueStatement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RevenueStatement" ADD COLUMN IF NOT EXISTS "finalPayout" DECIMAL(12,2) NOT NULL,
ADD COLUMN IF NOT EXISTS "tdsAmount" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "tdsPercentage" DECIMAL(5,2) NOT NULL DEFAULT 2.00;

COMMIT;
