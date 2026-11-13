-- CreateEnum
CREATE TYPE "IpAgreementStatus" AS ENUM ('DRAFT', 'ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "IpGameStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SplitStatus" AS ENUM ('PENDING', 'RESOLVED', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "IpSettlementStatus" AS ENUM ('GENERATED', 'PAID');

-- CreateEnum
CREATE TYPE "IpDailyJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "OrgType" ADD VALUE 'IP_PARTY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "RevenueSyncRunLog" ADD COLUMN     "unmappedSourceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unsplitCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "IpProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "pan" TEXT NOT NULL,
    "gstin" TEXT,
    "statementEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpAgreement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyOrganizationId" TEXT,
    "ipSharePct" DECIMAL(5,2) NOT NULL,
    "companySharePct" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "IpAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "contractPdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpGame" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "gameIdentifier" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "launchDate" TIMESTAMP(3),
    "status" "IpGameStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpGame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionSplit" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "grossAmount" DECIMAL(10,2) NOT NULL,
    "gstAmount" DECIMAL(10,2),
    "pgFeeAmount" DECIMAL(10,2),
    "netAmount" DECIMAL(10,2),
    "distributorShare" DECIMAL(10,2),
    "partnerShare" DECIMAL(10,2),
    "companyShare" DECIMAL(10,2),
    "isIpTransaction" BOOLEAN NOT NULL DEFAULT false,
    "ipOrganizationId" TEXT,
    "ipGameId" TEXT,
    "ipAgreementId" TEXT,
    "ipSharePct" DECIMAL(5,2),
    "ipShare" DECIMAL(10,2),
    "companyRetainedShare" DECIMAL(10,2),
    "kioskAssignmentId" TEXT,
    "distributorAgreementId" TEXT,
    "partnerAgreementId" TEXT,
    "status" "SplitStatus" NOT NULL DEFAULT 'PENDING',
    "unresolvedReason" TEXT,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpSettlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "grossRevenue" DECIMAL(12,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "pgFeeAmount" DECIMAL(12,2) NOT NULL,
    "networkShare" DECIMAL(12,2) NOT NULL,
    "companyShareBeforeRoyalty" DECIMAL(12,2) NOT NULL,
    "ipRoyaltyShare" DECIMAL(12,2) NOT NULL,
    "totalKioskCount" INTEGER NOT NULL DEFAULT 0,
    "finalPayout" DECIMAL(12,2),
    "pdfPath" TEXT,
    "status" "IpSettlementStatus" NOT NULL DEFAULT 'GENERATED',
    "emailDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpSettlementLine" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "ipGameId" TEXT,
    "gameIdentifier" TEXT NOT NULL,
    "gameDisplayName" TEXT NOT NULL,
    "kioskCount" INTEGER NOT NULL,
    "grossRevenue" DECIMAL(12,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "pgFeeAmount" DECIMAL(12,2) NOT NULL,
    "networkShare" DECIMAL(12,2) NOT NULL,
    "companyShareBeforeRoyalty" DECIMAL(12,2) NOT NULL,
    "ipRoyaltyShare" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpSettlementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpDailyGameRevenue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ipGameId" TEXT,
    "businessDate" DATE NOT NULL,
    "gameIdentifier" TEXT NOT NULL,
    "gameDisplayName" TEXT NOT NULL,
    "kioskCount" INTEGER NOT NULL DEFAULT 0,
    "grossRevenue" DECIMAL(12,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "pgFeeAmount" DECIMAL(12,2) NOT NULL,
    "networkShare" DECIMAL(12,2) NOT NULL,
    "companyShareBeforeRoyalty" DECIMAL(12,2) NOT NULL,
    "ipRoyaltyShare" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpDailyGameRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpDailyGameKiosk" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "gameIdentifier" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpDailyGameKiosk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpDailyPartySummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "kioskCount" INTEGER NOT NULL DEFAULT 0,
    "grossRevenue" DECIMAL(12,2) NOT NULL,
    "gstAmount" DECIMAL(12,2) NOT NULL,
    "pgFeeAmount" DECIMAL(12,2) NOT NULL,
    "networkShare" DECIMAL(12,2) NOT NULL,
    "companyShareBeforeRoyalty" DECIMAL(12,2) NOT NULL,
    "ipRoyaltyShare" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpDailyPartySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpDailyRevenueJobRun" (
    "id" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" "IpDailyJobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "partiesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "partiesProcessed" INTEGER NOT NULL DEFAULT 0,
    "batchesTotal" INTEGER NOT NULL DEFAULT 0,
    "batchesSuccessful" INTEGER NOT NULL DEFAULT 0,
    "batchesFailed" INTEGER NOT NULL DEFAULT 0,
    "splitsConsidered" INTEGER NOT NULL DEFAULT 0,
    "unresolvedSplitsExcluded" INTEGER NOT NULL DEFAULT 0,
    "missingGameAttributionCount" INTEGER NOT NULL DEFAULT 0,
    "recordsCreatedOrUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpDailyRevenueJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IpProfile_organizationId_key" ON "IpProfile"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IpProfile_sourceKey_key" ON "IpProfile"("sourceKey");

-- CreateIndex
CREATE INDEX "IpProfile_sourceKey_idx" ON "IpProfile"("sourceKey");

-- CreateIndex
CREATE INDEX "IpAgreement_organizationId_status_idx" ON "IpAgreement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "IpAgreement_organizationId_effectiveFrom_idx" ON "IpAgreement"("organizationId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "IpAgreement_companyOrganizationId_idx" ON "IpAgreement"("companyOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IpGame_gameIdentifier_key" ON "IpGame"("gameIdentifier");

-- CreateIndex
CREATE INDEX "IpGame_organizationId_status_idx" ON "IpGame"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionSplit_transactionId_key" ON "TransactionSplit"("transactionId");

-- CreateIndex
CREATE INDEX "TransactionSplit_businessDate_idx" ON "TransactionSplit"("businessDate");

-- CreateIndex
CREATE INDEX "TransactionSplit_ipOrganizationId_businessDate_idx" ON "TransactionSplit"("ipOrganizationId", "businessDate");

-- CreateIndex
CREATE INDEX "TransactionSplit_ipGameId_businessDate_idx" ON "TransactionSplit"("ipGameId", "businessDate");

-- CreateIndex
CREATE INDEX "TransactionSplit_status_idx" ON "TransactionSplit"("status");

-- CreateIndex
CREATE INDEX "IpSettlement_organizationId_year_month_idx" ON "IpSettlement"("organizationId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "IpSettlement_organizationId_month_year_key" ON "IpSettlement"("organizationId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "IpSettlementLine_settlementId_gameIdentifier_key" ON "IpSettlementLine"("settlementId", "gameIdentifier");

-- CreateIndex
CREATE INDEX "IpDailyGameRevenue_organizationId_businessDate_idx" ON "IpDailyGameRevenue"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "IpDailyGameRevenue_businessDate_idx" ON "IpDailyGameRevenue"("businessDate");

-- CreateIndex
CREATE INDEX "IpDailyGameRevenue_ipGameId_idx" ON "IpDailyGameRevenue"("ipGameId");

-- CreateIndex
CREATE UNIQUE INDEX "IpDailyGameRevenue_organizationId_businessDate_gameIdentifi_key" ON "IpDailyGameRevenue"("organizationId", "businessDate", "gameIdentifier");

-- CreateIndex
CREATE INDEX "IpDailyGameKiosk_organizationId_businessDate_idx" ON "IpDailyGameKiosk"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "IpDailyGameKiosk_organizationId_gameIdentifier_idx" ON "IpDailyGameKiosk"("organizationId", "gameIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "IpDailyGameKiosk_organizationId_businessDate_gameIdentifier_key" ON "IpDailyGameKiosk"("organizationId", "businessDate", "gameIdentifier", "kioskId");

-- CreateIndex
CREATE INDEX "IpDailyPartySummary_organizationId_businessDate_idx" ON "IpDailyPartySummary"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "IpDailyPartySummary_businessDate_idx" ON "IpDailyPartySummary"("businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "IpDailyPartySummary_organizationId_businessDate_key" ON "IpDailyPartySummary"("organizationId", "businessDate");

-- CreateIndex
CREATE INDEX "IpDailyRevenueJobRun_businessDate_status_idx" ON "IpDailyRevenueJobRun"("businessDate", "status");

-- CreateIndex
CREATE INDEX "IpDailyRevenueJobRun_leaseExpiresAt_idx" ON "IpDailyRevenueJobRun"("leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Transaction_source_occurredAt_idx" ON "Transaction"("source", "occurredAt");

-- AddForeignKey
ALTER TABLE "IpProfile" ADD CONSTRAINT "IpProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAgreement" ADD CONSTRAINT "IpAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAgreement" ADD CONSTRAINT "IpAgreement_companyOrganizationId_fkey" FOREIGN KEY ("companyOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpGame" ADD CONSTRAINT "IpGame_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_kioskAssignmentId_fkey" FOREIGN KEY ("kioskAssignmentId") REFERENCES "KioskAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_distributorAgreementId_fkey" FOREIGN KEY ("distributorAgreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_partnerAgreementId_fkey" FOREIGN KEY ("partnerAgreementId") REFERENCES "Agreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_ipOrganizationId_fkey" FOREIGN KEY ("ipOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_ipGameId_fkey" FOREIGN KEY ("ipGameId") REFERENCES "IpGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionSplit" ADD CONSTRAINT "TransactionSplit_ipAgreementId_fkey" FOREIGN KEY ("ipAgreementId") REFERENCES "IpAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpSettlement" ADD CONSTRAINT "IpSettlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpSettlementLine" ADD CONSTRAINT "IpSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "IpSettlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpSettlementLine" ADD CONSTRAINT "IpSettlementLine_ipGameId_fkey" FOREIGN KEY ("ipGameId") REFERENCES "IpGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpDailyGameRevenue" ADD CONSTRAINT "IpDailyGameRevenue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpDailyGameRevenue" ADD CONSTRAINT "IpDailyGameRevenue_ipGameId_fkey" FOREIGN KEY ("ipGameId") REFERENCES "IpGame"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpDailyGameKiosk" ADD CONSTRAINT "IpDailyGameKiosk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpDailyPartySummary" ADD CONSTRAINT "IpDailyPartySummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
