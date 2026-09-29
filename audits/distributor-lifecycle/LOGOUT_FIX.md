# Distributor logout fixed

Verified 2026-09-29 against the running frontend/API with the Distributor test login.

## Cause

The frontend called `POST /api/auth/logout`, but the backend had no logout route.
It ignored the error, cleared the client cache, and reported success while both
HTTP-only login cookies remained valid. JavaScript could not remove those cookies.

## Change

- Added `POST /api/auth/refresh/logout`. The nested path receives the existing
  refresh cookie, whose path is `/api/auth/refresh`.
- Delete only the presented refresh token's hashed database record, then clear
  access and refresh cookies with their matching paths and cookie attributes.
- Allow logout without a valid access token or active membership. Missing or
  previously deleted sessions return success and clear cookies again.
- The frontend prevents new automatic refreshes while signing out and waits for
  an already-running refresh before sending logout. Refresh/logout fetches have
  bounded timeouts. Successful logout clears the query cache and fully navigates
  to login; failure shows an error and enables retry instead of reporting success.
- Added an accessible Account menu label to the profile button.

This removes the current browser's session. Other stored sessions are retained.
Previously copied access JWTs retain their existing expiry; no JWT denylist or
schema migration was introduced. Kiosk, organization and payment data are unaffected.

## Verification

- Backend and frontend typechecks passed.
- Frontend lint: zero errors, 63 pre-existing warnings.
- Isolated regression: **14 HTTP requests, 10 assertions, zero mismatches**.
  Company, Distributor, Partner, expired-access, inactive-membership, missing-cookie
  and repeated-logout cases passed. The current refresh token was deleted,
  replay returned 401, and other sessions were preserved.
  [Evidence](20260929100841256/evidence.json).
- Running Distributor browser: **11 checks passed**. Real login and logout
  succeeded, both cookies disappeared, identity/kiosk requests returned 401,
  the old refresh token could not restore access, and visiting Kiosks returned
  to login. An injected first-attempt HTTP 503 verified failure handling and retry.
  [Evidence](logout-browser/verification.json).

```powershell
$env:AUDIT_PHASES='logout'
npx.cmd tsx --tsconfig apps/api/tsconfig.json audits/distributor-lifecycle/harness/distributor-lifecycle.ts
```
