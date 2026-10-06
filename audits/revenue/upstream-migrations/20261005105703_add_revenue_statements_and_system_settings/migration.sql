-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('GENERATED', 'PAID');

-- AlterEnum
ALTER TYPE "AgreementStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "NetworkStatus" ADD VALUE 'REJECTED';

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "gstPercentage" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "pgFeePercentage" DECIMAL(5,2) NOT NULL DEFAULT 2.50,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenueStatement" (
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
CREATE UNIQUE INDEX "RevenueStatement_organizationId_Month_Year_key" ON "RevenueStatement"("organizationId", "Month", "Year");

-- AddForeignKey
ALTER TABLE "RevenueStatement" ADD CONSTRAINT "RevenueStatement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
