-- Owner contact is required for new organization registrations by API validation.
-- Keep existing users/staff valid; do not infer a user's number from org phone.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "User" ADD COLUMN "contact" VARCHAR(10);
CREATE UNIQUE INDEX "User_contact_key" ON "User"("contact");
ALTER TABLE "User" ADD CONSTRAINT "User_contact_format"
  CHECK ("contact" IS NULL OR "contact" ~ '^[0-9]{10}$');
COMMIT;
