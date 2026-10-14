# Gateway reorder — live verification with the online database connected

Verified 2026-10-14. The question this answers: *can the dashboard's reorder button work
while the API runs against the database that the root `.env` actually names?*

Answer: **the database is not the blocker — Mothership is.** Every step up to and including
the upstream call works; the upstream 2xx's the request and stores nothing. The priority is
still changeable today, though — the per-provider upsert route does store it (see below).

## What the configured database is

The root `.env` points both URLs at the **online Supabase project**
(`postgres.vsednsppdlbcensnvwxq`, `aws-0-ap-southeast-2.pooler.supabase.com`), not at the
Docker database the setup notes describe. Read-only inspection
(`db-online-readonly-check.cjs` → `db-online-readonly-check.json`):

| Check | Result |
| --- | --- |
| Reachable | yes, PostgreSQL 17.6 |
| Migrations recorded | 18 |
| Tables/columns the app needs | all present (no missing table, no missing column) |
| `User` / `Organization` / `Membership` | 3 / 3 / 3 |
| `Kiosk` / `KioskAssignment` | 10 / 10 |
| `Order` / `OrderKiosk` / `Transaction` | 1 / 0 / 0 |
| ACTIVE COMPANY OWNER | `nileegames@gmail.com` (Anand Jha), org **NileeGames test** |

The blockers recorded in `audits/config-review/REMOTE-SWITCH-REVIEW.md` (0 users, missing
`Organization.phone`/`isActive`/`accessVersion`) no longer apply: the project has since been
migrated and populated. Nothing was written by this inspection — it runs inside
`BEGIN READ ONLY`.

## The reorder attempt, end to end

`verify-gateway-reorder-online.cjs` starts the real server (`src/server.ts`) with the root
`.env` untouched, logs in on that database, and performs exactly the request the dashboard
performs. All 12 checks passed:

| Step | Result |
| --- | --- |
| Server start + `GET /health`, `/health/db` | 200, "Database Connected!" |
| `POST /api/auth/login` (COMPANY OWNER on this DB) | 200, cookie issued |
| `GET /api/auth/me` | `type=COMPANY role=OWNER status=ACTIVE` — the gate the route needs |
| `GET /api/admin/gateways` **without** a session | **401** (our gate holds) |
| `GET /api/admin/gateways` with the session | 200, live order **razorpay → payu**, both active |
| `POST /api/admin/gateways/reorder` `{payu:1, razorpay:2}` | **502** "Mothership accepted the reorder request but did not apply the requested gateway priority order" |
| Read back | `requestedOrder=[payu,razorpay]` vs `liveOrder=[razorpay,payu]` |
| Priorities and `updated_at` after | unchanged, both providers |
| Logout | 200 |

Reaching the verification step at all means Mothership answered 2xx; the stored state then
disagreed with the request. Two attempts were made in total (one per harness run); neither
changed anything.

**Live routing is intact: razorpay (priority 1) → payu (priority 2), both enabled.** The
502 is the protective outcome — without the read-back the dashboard would have reported a
success that never happened.

## Why the arrows fail whichever way you click them

`/reorder` is direction-agnostic from Mothership's side: it answers 200
`{"status":"success","message":"Priorities updated."}` and stores nothing for *any* body —
move-up, move-down, or unparseable input alike. The UI therefore cannot switch the order
back either, and the message is identical because it is produced by our own read-back
check, not by the direction asked for.

That 502 is the correct outcome: the service reports success only when the stored order
matches the request, so "nothing happened" is never presented as "updated". To change the
order today, use the provider form's *Priority* field (upsert), or this folder's harness
with `--swap` / `--restore`.

## The alternative route: upsert stores priority (verified 2026-10-14)

`/reorder` is a stub, but `POST /api/admin/gateways` — the call the dashboard's own "Add or
update a provider" form already makes — **does persist `priority`**. The switch the reorder
button can no longer perform was executed through it (`verify-gateway-priority-upsert.cjs`
→ `gateway-priority-upsert.json`):

| Step | Request | Result |
| --- | --- | --- |
| 1 | `{ provider: 'payu', priority: 1 }` | 200 `Gateway 'payu' configured.`; state `payu=1 razorpay=1` |
| 2 | `{ provider: 'razorpay', priority: 2 }` | 200; state **`payu=1 razorpay=2`**, stable across repeated reads |
| after | both providers | `is_active=true`, `has_driver=true`, credential fields unchanged; only `updated_at` moved |

So the priority can be changed from the UI today: open the provider form, fill in *Priority*,
save. Only the move-up/move-down arrows are broken.

Write order matters and is recorded in the script: promoting payu first keeps a priority-1
provider present throughout (`payu=1`/`razorpay=1`); demoting razorpay first would briefly
leave no provider at priority 1 (`razorpay=2`/`payu=2`). Any reorder built on upserts is
therefore two calls, not one, with a visible tie in between — another reason Mothership
should implement `/reorder` properly.

**Live state: razorpay (priority 1) → payu (priority 2), both active.** The switch to
payu-first was reverted on request through the same route
(`verify-gateway-priority-upsert.cjs --restore` → `gateway-priority-restore.json`), in the
safe order (razorpay→1 first, so a priority-1 provider existed throughout). The payu-first
state is recorded in `gateway-priority-upsert.json`, the revert in
`gateway-priority-restore.json`.

Corrigendum: the `gateway-priority-upsert.json` run carries a `FAIL` entry for "both
providers still active with their credentials". That is a harness comparison bug — it
compared credential field lists across a list the swap itself reorders, and in read-only
mode read `credentialFields` off raw rows that expose `credentials` — not a state change.
The per-provider reads in that same file show `is_active`/`has_driver` true with identical
credential fields before and after, and the corrected comparison passes in
`gateway-priority-snapshot.json`.

## Side finding — the upstream list exposes identifiers anonymously

`check-gateway-credential-exposure.cjs`: `GET https://main.arcadelx.games/api/v1/admin/gateways`
answers **200 with no credentials**. Secrets are masked upstream (`key_secret`,
`webhook_secret`, `merchant_salt` all contain asterisks), but these do not:

- razorpay `key_id` (value length 23 — a live `rzp_live_…` id),
- payu `merchant_key` (length 6),
- payu `merchant_vpa` (length 21 — the UPI address).

No credential value is stored in this folder; the probe records field names, lengths and
masking only. These are identifiers rather than secrets, but they still identify the live
merchant accounts to anyone who asks, and the endpoint remains world-*writable* for
toggle/delete too. Our own `/api/admin/gateways` is the thing standing in front of that
(401 anonymous, verified above). Worth asking Mothership to authenticate its admin API.

## Port configuration mismatch (local only)

The root `.env` sets `PORT=3000`, which collides with the Next.js dev server (also 3000),
while the frontend proxies to 4000 (`apps/web/next-monorepo/apps/web/.env.local`:
`BACKEND_API_URL=http://localhost:4000`). For local use the API belongs on **4000**; the
value in `.env` was left as found and the override is passed per run.

## Reproduce

```powershell
node audits/gateways/db-online-readonly-check.cjs        # read-only, writes nothing to the DB
node audits/gateways/check-gateway-credential-exposure.cjs
node audits/gateways/verify-gateway-reorder-online.cjs   # one live reorder attempt, no retry
```

The harness reads the owner's login from the private `.env.local-backup-20261005` at run
time; no credentials are stored in these scripts or their outputs.

## What would make the button work

1. Mothership implements `POST /api/v1/admin/gateways/reorder` (our read-back verification
   then passes on its own — no change needed here), or
2. we switch the mechanism: reimplement `reorderGateways` as ordered upserts against
   `POST /api/v1/admin/gateways`. **Proven to store the new priorities** (above). Caveats:
   one call per provider, the demoted provider is written last so a priority-1 entry always
   exists, and the intermediate state is a visible tie.

**Option 2 was implemented and live-verified on 2026-10-14** -- `verify-gateway-reorder-live-fix.cjs`
-> `gateway-reorder-live-fix.json`, 12/12 checks. The move that used to 502 (payu first) now
returns 200 with the `liveOrder` it verified and the writes it made, a repeat of the current
order costs no write, and routing was left as found. Two notes for the next harness here:

- **Do not use port 4190** (or any other fetch-spec blocked port). Undici `fetch` refuses it
  with `TypeError: fetch failed | cause=bad port` while the server is listening and TCP
  connects -- which is why every earlier run of the live-fix harness failed at check 1 while
  the 4188/4189 harnesses passed. It now uses 4191.
- The acceptance run drives `POST /api/admin/gateways/reorder` on the running API, so it
  exercises the dashboard's own path, and it refuses to write unless the live order is the
expected `razorpay=1` / `payu=2`.
