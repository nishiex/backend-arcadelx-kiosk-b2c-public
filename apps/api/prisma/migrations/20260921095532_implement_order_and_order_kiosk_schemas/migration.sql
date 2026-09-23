-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('REQUEST', 'ALLOCATION');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('UNDER_REVIEW', 'APPROVED', 'DISPATCHED', 'DELIVERED', 'REJECTED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "parentOrgId" TEXT NOT NULL,
    "childOrgId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "depositPerMachine" DOUBLE PRECISION NOT NULL,
    "nonRefundablePerMachine" DOUBLE PRECISION NOT NULL,
    "totalDeposit" DOUBLE PRECISION NOT NULL,
    "totalNonRefundable" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION NOT NULL,
    "grandTotal" DOUBLE PRECISION NOT NULL,
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderKiosk" (
    "orderId" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,

    CONSTRAINT "OrderKiosk_pkey" PRIMARY KEY ("orderId","kioskId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- AddForeignKey
ALTER TABLE "KioskAssignment" ADD CONSTRAINT "KioskAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_childOrgId_fkey" FOREIGN KEY ("childOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "Agreement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderKiosk" ADD CONSTRAINT "OrderKiosk_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderKiosk" ADD CONSTRAINT "OrderKiosk_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
