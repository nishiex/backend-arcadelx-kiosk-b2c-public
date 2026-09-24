# Frontend Design (derived from the backend API)

Short spec mapping the Express API to frontend screens. All app calls go through the
`/api` proxy (see AGENTS.md). Auth is cookie-based (`credentials: 'include'`).

## Domain model (from Prisma)

- **OrgType**: `COMPANY` · `DISTRIBUTOR` · `PARTNER`
- **Role**: `OWNER` · `ADMIN` · `MANAGER` · `STAFF`
- Core entities: Organization, User/Membership, Kiosk (+ assignment/location), Agreement, NetworkConnection.

Role/org type gates what a user can see — the UI mirrors the backend guards below.

## Screens → endpoints

### 1. Auth (public)
- **Login** — `POST /api/auth/login`
- **Join org via invite** — `POST /api/auth/join`
- **Forgot password flow** (3 steps) — `POST /api/auth/forgot-password` → `POST /api/auth/verify-reset-otp` → `POST /api/auth/reset-password`
- Session bootstrap on load — `GET /api/auth/me`; silent `POST /api/auth/refresh` on 401.

### 2. Account
- **Change password** — `POST /api/auth/change-password`
- **Register organization** (only users allowed to create one) — `POST /api/auth/register`

### 3. Dashboard (home)
- **Inventory summary cards** — `GET /api/kiosks/summary` (counts by status).
- Pending-work badges: members `GET /api/members/requests`, network `GET /api/network/requests`.

### 4. Kiosks
- **List / table** — `GET /api/kiosks` (with `GET /api/kiosks/:id` detail drawer).
- **Batch create machine codes** — `POST /api/kiosks/batch` — *COMPANY only* (hide for others).
- **Update status** — `PATCH /api/kiosks/:id/status` — *COMPANY / DISTRIBUTOR only*.

### 5. Members (COMPANY, OWNER/ADMIN only — hide section otherwise)
- **Generate invite code** — `POST /api/members/generateInviteCode`
- **Pending requests list** — `GET /api/members/requests` (paginated `?page&limit`)
- **Approve / reject** — `POST /api/members/requests/:membershipId`
- **Change role** — `PATCH /api/members/:membershipId/role`
- **Remove member** — `DELETE /api/members/:membershipId`

### 6. Network (COMPANY / DISTRIBUTOR, OWNER/ADMIN)
- **Initiate connection** — `POST /api/network/initiate`
- **Pending requests** — `GET /api/network/requests`
- **Accept** — `POST /api/network/:connectionId/accept`
- **Remove connection** — `DELETE /api/network/:connectionId` (OWNER only)

### 7. Agreements (COMPANY / DISTRIBUTOR, OWNER only)
- **Create agreement** — `POST /api/agreements`
- **Approve** — `PATCH /api/agreements/:agreementId/approve`
- **Terminate** — `DELETE /api/agreements/:agreementId/terminate`
- Distributors see the deposit/non-refundable amounts as fixed (set during the company↔distributor agreement); render read-only.

> `/api/internal/*` is server-to-server (kiosk pairing, secret-header auth) — **not** used by the web UI.

## Role-based navigation

| Nav item   | COMPANY            | DISTRIBUTOR        | PARTNER |
| ---------- | ------------------ | ------------------ | ------- |
| Dashboard  | ✅                 | ✅                 | ✅      |
| Kiosks     | ✅ (create/status) | ✅ (status)        | view    |
| Members    | ✅ (OWNER/ADMIN)   | —                  | —       |
| Network    | ✅ (OWNER/ADMIN)   | ✅ (OWNER/ADMIN)   | —       |
| Agreements | ✅ (OWNER)         | ✅ (OWNER)         | —       |

Enforcement is on the backend; the frontend hides/disables actions to match, and treats
a 401 as "refresh then re-login" and a 403 as "not permitted for your role".

## Conventions

- Data fetching via TanStack Query (already set up in `providers/QueryProvider.tsx`); mutations invalidate the relevant list query.
- API responses are `{ statusCode, data, message, success }` — unwrap `data` (see `lib/backend-api.ts`).
- Toasts via `sonner` for mutation success/error using the API `message`.
- Validation with the same Zod schemas the backend uses (`@shared-types/validationSchemas/*`) to keep client/server rules identical.
