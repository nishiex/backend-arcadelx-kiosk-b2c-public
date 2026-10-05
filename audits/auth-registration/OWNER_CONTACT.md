# Owner contact integration from Backend 1e519e3

Organization registration now requires `ownerContact`, a trimmed string containing
exactly ten digits. Duplicate contacts return HTTP 409; a unique database index
also protects concurrent registrations. The registration response includes
`owner.contact` as a string. Existing GST, organization phone, invite consumption,
membership creation and encrypted credential delivery are preserved.

The Distributor and Partner forms require this field with matching validation.
The Distributor's existing organization phone stays separate and optional.
The Partner form also exposes the existing optional GST field.

## Compatibility decisions

Upstream makes `User.contact` a required BigInt without a migration and leaves
staff registration and the Company seed without a contact. This integration uses
nullable `VARCHAR(10)` with a unique index and a format check. It preserves leading
zeros, allows existing users/staff/seed to omit contact, and does not invent or
copy numbers from organization profiles. New organization owners must supply it
through API validation. Multiple null values are allowed; duplicate numbers are
not.

The shared Prisma client omits contact by default to keep it out of unrelated
user queries/responses and maintain existing auth on databases where the new
column has not been deployed. Explicit selects can read it when needed.
Registration returns a clear HTTP 503 if that column is absent, without consuming
an invitation or creating records. GST and existing profile/access fields remain
unchanged.

## Migration and deployment

`apps/api/prisma/migrations/20261005190000_add_owner_contact/migration.sql` adds
the nullable column, unique index and format check. It has been applied only to
a new isolated local test database. **It has not been applied to the configured
Supabase database.** No live users or contacts were changed, and no real emails
were sent. Deploy the reviewed migration before using owner registration.

If a database already has the upstream BigInt column, reconcile its type and
history before applying this migration; it deliberately does not overwrite an
existing column. Historical migration divergence and organization profile/access
deployment remain separate concerns documented in `apps/api/AGENTS.md`.

## Verification

- 204 combined API/database checks passed, including existing authentication,
  invitations and revenue flows, invalid/missing contact, duplicate/concurrent
  registration, exact leading-zero preservation, independent organization phone
  and GST, credential delivery, and login/dashboard identity.
- Migration tested with an existing user lacking contact; existing values remain
  intact and contact stays null. Database format constraints tested independently.
- A temporarily renamed column in the isolated database proves existing login,
  identity and staff invitation/registration still work before deployment; owner
  registration returns 503 until the column is restored.
- Distributor and Partner component checks passed using mocked HTTP, including
  required/invalid contact, string payloads, error recovery and existing email
  retry/invite behavior.
- API typecheck and Prisma validation passed. Targeted frontend lint has no
  errors (two existing Distributor warnings). Full frontend typecheck still has
  the pre-existing `dashboard/ui.tsx:130` KioskStatus mismatch.

Run from the repository root:

```powershell
node -r ./audits/auth-registration/runtime-loader.cjs audits/auth-registration/verify.cjs
node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/owner-contact-ui-check.tsx
node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/partner-registration-ui-check.tsx
npx.cmd tsc --noEmit -p apps/api/tsconfig.json
```
