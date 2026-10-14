CREATE TYPE "DevicePriceRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPROVED', 'REJECTED');

CREATE TABLE "DevicePriceRequest" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "replayPrice" DECIMAL(10,2) NOT NULL,
    "requesterOrgId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "DevicePriceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "processingAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DevicePriceRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DevicePriceRequest_requesterOrgId_status_idx" ON "DevicePriceRequest"("requesterOrgId", "status");
CREATE INDEX "DevicePriceRequest_status_createdAt_idx" ON "DevicePriceRequest"("status", "createdAt");

ALTER TABLE "DevicePriceRequest" ADD CONSTRAINT "DevicePriceRequest_requesterOrgId_fkey"
  FOREIGN KEY ("requesterOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DevicePriceRequest" ADD CONSTRAINT "DevicePriceRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DevicePriceRequest" ADD CONSTRAINT "DevicePriceRequest_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
