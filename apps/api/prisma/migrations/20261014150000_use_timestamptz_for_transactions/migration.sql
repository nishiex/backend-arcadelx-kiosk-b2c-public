-- Existing transaction timestamps were written as UTC wall-clock values into
-- timestamp without time zone. Interpret those historical values as UTC while
-- converting the column so future Date values retain their absolute instant.
ALTER TABLE "Transaction"
  ALTER COLUMN "occurredAt" TYPE TIMESTAMPTZ(3)
  USING "occurredAt" AT TIME ZONE 'UTC';
