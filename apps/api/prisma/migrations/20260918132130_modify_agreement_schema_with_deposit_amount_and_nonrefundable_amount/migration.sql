/*
  Warnings:

  - Added the required column `depositAmountPerMachine` to the `Agreement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nonRefundableAmountPerMachine` to the `Agreement` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Agreement" ADD COLUMN     "depositAmountPerMachine" INTEGER NOT NULL,
ADD COLUMN     "nonRefundableAmountPerMachine" INTEGER NOT NULL;

ALTER TABLE "Agreement"
  ADD CONSTRAINT "depositAmountPerMachine_positive" CHECK ("depositAmountPerMachine" >= 0),
  ADD CONSTRAINT "nonRefundableAmountPerMachine_positive" CHECK ("nonRefundableAmountPerMachine" >= 0);