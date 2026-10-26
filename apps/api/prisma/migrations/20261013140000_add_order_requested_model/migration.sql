-- Keep the requested machine model on orders so request availability can be
-- validated when submitted and the same model can be reserved on approval.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "requestedModel" TEXT;
