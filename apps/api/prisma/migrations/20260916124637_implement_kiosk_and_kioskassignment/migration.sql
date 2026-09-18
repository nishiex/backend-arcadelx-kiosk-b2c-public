-- CreateEnum
CREATE TYPE "KioskStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'INSTALLED', 'MAINTENANCE', 'RETURNED', 'RETIRED');

-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS "kiosk_machine_code_seq" START 1;

-- CreateTable
CREATE TABLE "Kiosk" (
    "id" TEXT NOT NULL,
    "machineCode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "KioskStatus" NOT NULL DEFAULT 'AVAILABLE',
    "externalDeviceId" TEXT,
    "currentOrgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KioskAssignment" (
    "id" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "assignedById" TEXT NOT NULL,
    "assignedFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedTo" TIMESTAMP(3),

    CONSTRAINT "KioskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_machineCode_key" ON "Kiosk"("machineCode");

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_externalDeviceId_key" ON "Kiosk"("externalDeviceId");

-- CreateIndex
CREATE INDEX "KioskAssignment_kioskId_assignedTo_idx" ON "KioskAssignment"("kioskId", "assignedTo");

-- CreateIndex
CREATE INDEX "KioskAssignment_organizationId_assignedTo_idx" ON "KioskAssignment"("organizationId", "assignedTo");

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_currentOrgId_fkey" FOREIGN KEY ("currentOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskAssignment" ADD CONSTRAINT "KioskAssignment_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskAssignment" ADD CONSTRAINT "KioskAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KioskAssignment" ADD CONSTRAINT "KioskAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
