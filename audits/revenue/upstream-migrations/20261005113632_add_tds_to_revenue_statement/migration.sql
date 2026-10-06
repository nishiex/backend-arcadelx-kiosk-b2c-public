/*
  Warnings:

  - Added the required column `finalPayout` to the `RevenueStatement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tdsAmount` to the `RevenueStatement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RevenueStatement" ADD COLUMN     "finalPayout" DECIMAL(12,2) NOT NULL,
ADD COLUMN     "tdsAmount" DECIMAL(12,2) NOT NULL;

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "tdsPercentage" DECIMAL(5,2) NOT NULL DEFAULT 2.00;
