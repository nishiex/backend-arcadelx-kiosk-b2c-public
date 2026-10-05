# Company -> Distributor -> Partner auth flow

Verified 2026-10-05. Existing authentication, password hashing, sessions and APIs are reused.

## Map established before changes

| Step | Existing implementation | Finding |
| --- | --- | --- |
| Identity | User, Organization, ACTIVE OWNER Membership | Existing models sufficient |
| Company registers Distributor | POST /api/auth/register, active Company OWNER/ADMIN, single-use Company invite | Existing backend flow preserved |
| Distributor registers Partner | Same endpoint with orgType PARTNER, active Distributor OWNER/ADMIN | Existing backend sufficient; Partner tab/form added |
| Password | crypto.randomBytes(8), base64url, bcrypt cost 10 | Reused; API returns no password/hash |
| Creation and email | Transaction creates user/org/membership and encrypted EmailDelivery; existing Mailjet and scoped retry | Reused; creator cookies preserved; delivered credential payload erased |
| Sessions | Existing login, JWT cookies, refresh, logout, password change/reset | Shared across all organization types |
| Permissions | Active membership and organization/role guards | Distributor cannot perform Company-only actions |
| Online schema | Remote revert removed five existing Organization fields | Registration reproduced HTTP 500 on an isolated database |
| Email configuration | Dummy Mailjet keys | Restored verified saved configuration |

## Minimal repair

The Distributor Partners tab and registration modal use existing register and credential-retry APIs. Company registration remains on its existing form.

Restored existing Organization fields in Prisma and applied additive migration `20261005121000_restore_registration_fields`: gstNumber, phone, country, isActive and accessVersion. Access fields are needed by existing Prisma creation defaults; true/zero match previous effective access defaults. Existing organization core-data fingerprints were unchanged. No auth handler, session logic, password policy or API contract changed.

Ignored environment configuration now uses the responding port 5432 endpoint of the same online database and verified saved Mailjet keys. No secrets were added to source. The prior order repair already restored EmailDelivery.

## Verification

- 108 isolated HTTP/DB checks passed: registration, password hashing/privacy, credential login, email failure/retry, creator sessions, role gates, Partner refresh/password change/logout, invite rollback/concurrency, and repeat repair preserving disabled access.
- Partner component tests passed: permissions, validation, duplicate prevention, request shape/cookies, retry and modal lifecycle.
- API typecheck and Prisma validate passed.
- Scoped frontend lint: no errors; existing AddDistributor warnings remain.
- API has no lint script/configuration. Frontend typecheck retains the existing `components/dashboard/ui.tsx:130` KioskStatus mismatch.
- Native Prisma migrate status was blocked by sandbox spawn EPERM. Read-only SQL history checks found no pending local migrations and confirmed the repair checksum. Three remote-only migrations remain; complete schema/history reconciliation is not claimed.
- Live API database health and Partner page return 200. Unauthenticated auth/me through the frontend proxy returns the expected 401.
- Mailjet authentication and configured sender authorization verified. Actual mailbox delivery remains untested; isolated tests capture emails locally.

Commands and evidence: [registration repair](auth-registration/README.md).
