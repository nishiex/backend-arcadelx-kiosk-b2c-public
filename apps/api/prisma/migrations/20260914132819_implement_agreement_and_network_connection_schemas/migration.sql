-- CreateEnum
CREATE TYPE "NetworkStatus" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'TERMINATED');

-- CreateTable
CREATE TABLE "NetworkConnection" (
    "id" TEXT NOT NULL,
    "initiatorOrgId" TEXT NOT NULL,
    "receiverOrgId" TEXT NOT NULL,
    "status" "NetworkStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "networkConnectionId" TEXT NOT NULL,
    "parentOrgId" TEXT NOT NULL,
    "childOrgId" TEXT NOT NULL,
    "parentSharePct" DECIMAL(5,2) NOT NULL,
    "childSharePct" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "AgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "NetworkConnection" ADD CONSTRAINT "NetworkConnection_initiatorOrgId_fkey" FOREIGN KEY ("initiatorOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkConnection" ADD CONSTRAINT "NetworkConnection_receiverOrgId_fkey" FOREIGN KEY ("receiverOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_networkConnectionId_fkey" FOREIGN KEY ("networkConnectionId") REFERENCES "NetworkConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agreement" ADD CONSTRAINT "Agreement_childOrgId_fkey" FOREIGN KEY ("childOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
