-- AlterTable
ALTER TABLE "Kiosk" ADD COLUMN     "location" TEXT;

-- CreateTable
CREATE TABLE "MachineSequence" (
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MachineSequence_pkey" PRIMARY KEY ("year")
);
