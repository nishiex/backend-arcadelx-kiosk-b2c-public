-- Add terminal rejection states without deleting requests or their history.
ALTER TYPE "NetworkStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "AgreementStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
