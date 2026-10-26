-- Owner contact is required for new organization registrations by API validation.
-- Keep existing users/staff valid; do not infer a user's number from org phone.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "contact" VARCHAR(10);
CREATE UNIQUE INDEX IF NOT EXISTS "User_contact_key" ON "User"("contact");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'User_contact_format') THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_contact_format"
      CHECK ("contact" IS NULL OR "contact" ~ '^[0-9]{10}$');
  END IF;
END $$;
COMMIT;
