-- CreateEnum
CREATE TYPE "AdStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "videoFilename" VARCHAR(500) NOT NULL,
    "originalFilename" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "videoSizeBytes" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "status" "AdStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdKiosk" (
    "adId" TEXT NOT NULL,
    "kioskId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdKiosk_pkey" PRIMARY KEY ("adId","kioskId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ad_videoFilename_key" ON "Ad"("videoFilename");

-- CreateIndex
CREATE INDEX "Ad_organizationId_status_idx" ON "Ad"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Ad_organizationId_createdAt_idx" ON "Ad"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdKiosk_kioskId_idx" ON "AdKiosk"("kioskId");

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdKiosk" ADD CONSTRAINT "AdKiosk_adId_fkey" FOREIGN KEY ("adId") REFERENCES "Ad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdKiosk" ADD CONSTRAINT "AdKiosk_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE CASCADE ON UPDATE CASCADE;
