# Secret rotation audit and procedure

Audited 2026-10-12. **No secrets were changed, generated, or printed.** `.env`, the local
Postgres container, and the running services are untouched. No commit, push, migration, or
seed was performed.

Rotation order below is deliberate: secrets whose rotation has the widest blast radius and
the least coordination overhead go first.

---

## 1. Inventory: what is in use, and where

Every secret has exactly **one** configured source: the ignored root `.env`, loaded by the API
(`apps/api/src/server.ts` → `dotenv.config({ path: "../../.env" })`) and by the Prisma CLI
(`apps/api/prisma.config.ts`).

| # | Secret | Len | Read at | Consumers |
| - | ------ | --- | ------- | --------- |
| 1 | `ACCESS_SECRET_TOKEN` | 128 | `utils/token.ts:42` (sign), `middlewares/auth.ts:25` (verify) | Every authenticated request |
| 2 | `REFRESH_SECRET_TOKEN` | 128 | `utils/token.ts:43` (sign) | Login/refresh token issuance |
| 3 | `INTERNAL_API_SECRET` | 128 | `middlewares/internal.auth.ts` (verify), `services/email/delivery.service.ts:29` (key derivation) | Mothership → API calls; encrypted delivery payloads |
| 4 | `MAILJET_API_KEY` | 32 | `services/email/email.service.ts:6` | All outbound email |
| 5 | `MAILJET_SECRET_KEY` | 32 | `services/email/email.service.ts:7` | All outbound email |
| 6 | `DATABASE_URL` / `DIRECT_URL` | 59 | `utils/db.ts`, `prisma.config.ts` | Local Postgres only (`localhost:5433`) |

Two notes that shape the procedure:

- **JWT keys are read once, at module load.** `middlewares/auth.ts:25` captures
  `ACCESS_SECRET_TOKEN` into a module-level `const`. A running server therefore does **not**
  pick up a changed value until it restarts. Rotation is not live until restart.
- **`INTERNAL_API_SECRET` serves two purposes.** Besides authenticating `/api/internal`, it is
  the input to `sha256("email-delivery:v1:" + secret)`, the AES-256-GCM key protecting queued
  email payloads (`delivery.service.ts:27-52`). Rotating it makes existing ciphertext
  undecryptable.

## 2. Exposure check

| Check | Result |
| ----- | ------ |
| Has `.env` ever been committed? | **No** — `git log --all -- .env` is empty |
| Is `.env` ignored? | **Yes** — `.gitignore:18` (`.env*`) |
| Any live secret value in git history (`git log --all -S`)? | **None**, for all five secrets, across 72 commits |
| Any live secret in `audits/`, `.zwork/`, or built output? | **None** |
| `apps/api/api/index.mjs` (build bundle) | References variable *names* only; contains no literal values; gitignored |
| `.env.example` (tracked) | Placeholders only — `ACCESS_SECRET_TOKEN`/`REFRESH_SECRET_TOKEN`/`INTERNAL_API_SECRET`/Mailjet keys are **empty**; its `DATABASE_URL` is a doc placeholder (`host:5432/DATABASE`), not the live URL |
| `.env.local-backup-20261005` (gitignored) | Contains **no** secret values (fields present but empty) |

**Conclusion:** nothing leaked through this repository. The exposure is the chat message in
which the values were pasted, which is why rotation is still warranted.

## 3. Impact of rotating the JWT keys

| Area | Effect |
| ---- | ------ |
| Access tokens (15m TTL) | Immediately invalid. Browsers get **401** and the frontend's single-flight refresh runs once (`apiFetch` in `backend-api.ts`) |
| Refresh tokens (7d TTL) | **The real consequence.** After rotation, `jwt.verify` fails for old refresh tokens, so the refresh call 401s and the user is redirected to `/login` (`AuthGuard`) |
| Live sessions | **All 45 `RefreshToken` rows** in the local database become unusable — every logged-in user must sign in again |
| Data loss | None. `RefreshToken` rows are bookkeeping, not credentials |
| Server downtime | None required, but the new key only takes effect **after restart**; there is a window where the old key still validates |
| Cross-service callers | None for the JWT pair — verified no other service reads these |

Rotating `ACCESS` and `REFRESH` **together** is safest: rotating only one leaves the other
half of the pair inconsistent, which presents as "login works, then the session dies on
refresh" — harder to diagnose than a clean logout.

## 4. Procedure

Perform one step at a time. **Stop and report if any verification fails** rather than
continuing down the list.

### Phase 0 — preparation (no behaviour change)

1. Confirm no deployment is mid-flight and no user is mid-order.
2. Note the current restart command for the API (it is `npm run dev` from `apps/api`, or the
   background process currently holding port 4000).
3. Record the verification commands in section 5, so rotation can be proven immediately.

### Phase 1 — JWT signing keys (priority: highest)

4. In the provider/secret store: generate **two** new independent high-entropy values
   (≥64 chars, e.g. `openssl rand -hex 64`). They must be different from each other.
5. Update `ACCESS_SECRET_TOKEN` and `REFRESH_SECRET_TOKEN` in the **ignored** root `.env`
   simultaneously (never one alone).
6. **Restart the API** — required, because the keys are captured at module load.
7. Verify with section 5, checks 1-4. Every existing session should now fail and require login.
8. **Tell users they will be logged out.** This is the expected, visible consequence.

### Phase 2 — `INTERNAL_API_SECRET`

9. Before rotating, drain the delivery queue: confirm **zero** unsent rows.
   Query: `select count(*) from "EmailDelivery" where "sentAt" is null;`
   If it is not zero, **do not rotate yet** — those payloads are encrypted with the current
   secret and would become undecryptable.
10. Generate the new value (≥32 chars; `env.ts` enforces a 32-char minimum).
11. Update `INTERNAL_API_SECRET` in `.env`.
12. **Restart the API.**
13. **Update every external caller** that sends `X-Internal-Api-Key` — this is the only secret
    needing coordination outside this repository. The header name is exact
    (`middlewares/internal.auth.ts`: `X-Internal-Api-Key`; a wrong header name returns
    "Missing internal authentication key").
14. Verify with section 5, check 5.

### Phase 3 — Mailjet credentials

15. In the Mailjet account, create a **new API key** (keep the old one active until verified).
16. Update `MAILJET_API_KEY` and `MAILJET_SECRET_KEY` in `.env`.
17. **Restart the API** — the client is constructed at module load
    (`email.service.ts:5-8`), and an empty key crashes startup.
18. Verify with section 5, check 6 (a real send).
19. **Only then revoke the old Mailjet key** in the dashboard.
20. Note: in production `MAILJET_*` are **required** (`env.ts:28-29`); in development they are
    optional, so a missing value surfaces later rather than at boot.

### Phase 4 — database password

21. **Supabase only, and only if you intend to use it.** The local Postgres
    (`localhost:5433`) password is a throwaway dev value and rotating it means recreating the
    container's credentials; there is no security benefit, so leave it alone unless the local
    password was also shared.
22. In the Supabase dashboard: **Settings → Database → Reset database password**.
23. Update **both** `DATABASE_URL` and `DIRECT_URL` together — one is the transaction pooler
    (6543) and the other the session pooler (5432), and they must stay consistent.
24. **Restart the API**, then verify with section 5, check 7.
25. Note: the remote database is currently **empty and missing required columns** (see
    `audits/config-review/REMOTE-SWITCH-REVIEW.md`), so pointing at it will break login and
    registration until it is migrated and seeded. Rotating its password alone does not make it
    usable.

## 5. Verification without revealing values

Run after each phase. These confirm the **new** configuration is live without printing any
secret.

| # | Check | Command | Expected |
| - | ----- | ------- | -------- |
| 1 | API restarted with new keys | `curl -s -o NUL -w "%{http_code}" http://localhost:4000/health` | `200` |
| 2 | Old access token rejected | `curl` any authenticated path with a token minted before rotation | `401` |
| 3 | Login still works | `POST /api/auth/login` with a real account | `200` |
| 4 | Refresh no longer accepts pre-rotation tokens | Reuse a refresh cookie captured before rotation | `401` |
| 5 | Internal auth uses the new secret | `GET /api/internal/kiosks/unpaired` with and without `X-Internal-Api-Key` | `401` without; `200` with the new value |
| 6 | Mailjet send works | Send one test email | Mailjet reports `Status: "success"` |
| 7 | Database still connects | `curl http://localhost:4000/health/db` | `{"data":"Database Connected!"}` |

A safe way to compare secrets without printing them is a truncated SHA-256 prefix, e.g.:

```powershell
$v = ((Select-String -Path .env -Pattern '^ACCESS_SECRET_TOKEN=').Line -split '=',2)[1].Trim()
[System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().
  ComputeHash([System.Text.Encoding]::UTF8.GetBytes($v))).Replace('-','').Substring(0,16)
```

Compare that prefix before and after the change to confirm the value actually changed,
without either value appearing anywhere.

## 6. What I did not do, and why

- **Did not generate replacement secrets.** Doing so and claiming them active without updating
  and verifying `.env` is exactly the failure mode to avoid.
- **Did not modify `.env`.** The task requires the current configuration to remain unchanged
  until the plan is approved.
- **Did not switch database targets, migrate, seed, commit, or push.**
- **Did not dashboards-side actions.** Phases 1-4 require your credentials in the provider
  dashboards; I cannot and should not perform them.

## 7. Safest sequence, in one line

**JWT pair (restart, expect all users logged out) → `INTERNAL_API_SECRET` (only with a drained
queue, and only after updating external callers) → Mailjet (new key first, revoke old after a
successful send) → database password (only for Supabase, and only once that database is
actually usable).**

The JWT pair goes first because it is the only secret whose compromise allows forging sessions
for any user, it needs no coordination with outside systems, and its worst case — everyone
signs in again — is fully recoverable.
