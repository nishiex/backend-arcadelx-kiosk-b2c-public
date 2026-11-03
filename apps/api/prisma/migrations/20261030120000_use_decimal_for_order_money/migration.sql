-- AlterTable: Change Order money fields from DOUBLE PRECISION (float) to DECIMAL for precision
ALTER TABLE "Order"
  ALTER COLUMN "depositPerMachine" TYPE DECIMAL(12,2) USING "depositPerMachine"::DECIMAL(12,2),
  ALTER COLUMN "nonRefundablePerMachine" TYPE DECIMAL(12,2) USING "nonRefundablePerMachine"::DECIMAL(12,2),
  ALTER COLUMN "totalDeposit" TYPE DECIMAL(12,2) USING "totalDeposit"::DECIMAL(12,2),
  ALTER COLUMN "totalNonRefundable" TYPE DECIMAL(12,2) USING "totalNonRefundable"::DECIMAL(12,2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(12,2) USING "taxAmount"::DECIMAL(12,2),
  ALTER COLUMN "grandTotal" TYPE DECIMAL(12,2) USING "grandTotal"::DECIMAL(12,2);
