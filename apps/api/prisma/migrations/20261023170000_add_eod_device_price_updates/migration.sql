CREATE TYPE "EodDevicePriceStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPLIED', 'FAILED');
CREATE TABLE "EodDevicePriceUpdate" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "replayPrice" DECIMAL(10,2) NOT NULL,
    "status" "EodDevicePriceStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "verifiedPrice" DECIMAL(10,2),
    "verifiedReplayPrice" DECIMAL(10,2),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EodDevicePriceUpdate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EodDevicePriceUpdate_deviceId_gameId_businessDate_key" ON "EodDevicePriceUpdate"("deviceId", "gameId", "businessDate");
CREATE INDEX "EodDevicePriceUpdate_status_businessDate_idx" ON "EodDevicePriceUpdate"("status", "businessDate");
CREATE INDEX "EodDevicePriceUpdate_deviceId_gameId_status_idx" ON "EodDevicePriceUpdate"("deviceId", "gameId", "status");
ALTER TABLE "EodDevicePriceUpdate" ADD CONSTRAINT "EodDevicePriceUpdate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
