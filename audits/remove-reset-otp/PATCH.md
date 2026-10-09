# Remove the 6-digit reset OTP / forgot-password flow

Patch instructions for the approved plan. This document is the whole deliverable.

## Why you have to apply this, not me

The AutoClaw Safety Guard rejects any workspace write whose *resulting file* contains an
assignment whose left-hand key looks like a credential. Two attempts proved it:

- editing `apps/api/src/controllers/auth.controller.ts` is blocked by a pre-existing line
  (around 358) that reads the refresh cookie into a local variable
- editing `packages/shared-types/validationSchemas/auth.validation.ts` is blocked by the
  Zod field named `password` inside the schema bodies

Both are false positives, and neither is removable: the cookie name is fixed by
`utils/token.ts`, and a password schema needs a `password` key. The guard validates the whole
post-write file rather than the diff, so narrowing a write to one hunk does not help. The
frontend files in scope carry the same shapes.

I also tried to deliver an apply script, but a script has to embed the rewritten handler,
which contains a hash assignment the guard refuses. That script was deleted rather than
shipped broken. For the same reason this file must describe a couple of lines instead of
quoting them; each such spot is called out.

**Current tree state: unmodified.** A partial edit to `auth.routes.ts` was reverted.
`git status` shows only untracked `audits/` directories. `npx tsc --noEmit` in `apps/api`
exits 0.

## Line endings

Every file below is CRLF. If you apply these with a script, normalise the file and your
anchor to the same convention before matching — my first attempt failed every anchor because
the anchors were LF while the files are CRLF. Anchors quoted below are taken from the files as
they are on disk.

Apply in order. Steps 1–3 are what actually remove the OTP.

---

## 1. `apps/api/src/routes/auth.routes.ts`

In the import from `../controllers/auth.controller`, keep `registerOrganization`,
`joinOrganization`, `login`, `logout`, `refresh`, `getMe`, `changePassword`,
`retryOrganizationCredentials` and delete `forgotPassword`, `verifyResetOtp`,
`completeForgotPassword`.

Then delete these three lines (52–54):

```ts
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", completeForgotPassword);
```

## 2. `apps/api/src/controllers/auth.controller.ts`

**2a. Imports.**

In the import from `@shared-types/validationSchemas/auth.validation`, keep
`RegisterOrgSchema`, `JoinOrgSchema`, `LoginSchema`, drop the three reset schemas
(`ForgotPasswordSchema`, `VerifyResetOtpSchema`, `CompletePasswordResetSchema`), and rename
`ResetPasswordSchema` to `ChangePasswordSchema`.

Replace the email import (lines 25–30) so it reads:

```ts
import { sendPasswordChangedEmail } from "../services/email/password.email";
```

Delete the util import at lines 31–35 entirely — the three names it brings in are used only by
the handlers being removed.

**2b. Delete handler bodies from line 530 to EOF (788).** `forgotPassword` starts at 530 and is
followed directly by `verifyResetOtp` (597) and `completeForgotPassword` (702) to the end of
the file, so this is one cut. Keep lines 1–529.

**2c. Rewrite `changePassword` (lines 462–529)** so identity comes from the session instead of
the request body. This is the P0 fix: today the handler reads an email field out of the parsed
body and looks the user up by it, so a session for one account can change another account's
password if it knows the current one.

Shape of the rewritten handler:

1. Parse the body with `ChangePasswordSchema`, taking only the current and new password.
2. Look the user up by `req.user!.id` — not by email, and not from the body. Throw 404 when
   absent.
3. Compare the submitted current password against the stored hash; on mismatch throw
   `401 "Current password is incorrect"`.
4. Reject a new password equal to the current one with `400`.
5. Inside one `prisma.$transaction`: update the stored hash, and delete every refresh token for
   that user so all sessions die with the old password.
6. Call `clearTokenCookies(res)` — already imported at line 22 and previously unused here — so
   the caller's own now-revoked cookies are dropped.
7. Await `sendPasswordChangedEmail({ email: user.email, name: user.name })`. It is already
   imported but was never called; the old password is gone, so notify.
8. Respond 200 with `null` data and the message "Password changed successfully. Please log in
   again."

The two assignments inside the transaction (the hash write and the token deletion) are the
lines I cannot quote here; they are the same statements the current handler already contains
in its transaction block, so keep those and change only what surrounds them.

## 3. `packages/shared-types/validationSchemas/auth.validation.ts`

Replace lines 101–111 (`ResetPasswordSchema`) with `ChangePasswordSchema`, dropping the `email`
field and reusing the existing `passwordSchema` so the 8–128 rule stays in one place. The three
fields become the current password, the new password, and the confirmation; keep the existing
`.refine` that compares the two new values.

Then delete the trailing block at lines 113–140: `ForgotPasswordSchema`, `VerifyResetOtpSchema`
(this is the one carrying the six-digit regex), and `CompletePasswordResetSchema`.

## 4. `apps/api/src/services/email/passwordreset.email.ts` → `password.email.ts`

Delete `PasswordResetEmailParams` (lines 9–13) and `sendPasswordResetOtpEmail` (lines 15–62).
Keep `sendPasswordChangedEmail`. Rename the file to `password.email.ts`, which is the path step
2a already expects.

After removing the OTP body, the credential-style helper in the import from `./email-theme` is
no longer used by this file — drop it from that import or the build emits an unused import. It
stays exported from `email-theme.ts` for the credentials email.

## 5. Delete these files

- `apps/api/src/utils/passwordReset.ts` — exports `generateOtp`, `generateResetToken`,
  `hashResetValue`; grep confirms they are referenced only by the handlers deleted in step 2b.
- `apps/web/next-monorepo/apps/web/app/forgot-password/page.tsx`
- `apps/web/next-monorepo/apps/web/components/auth/ForgotPasswordForm.tsx`
- the now-empty `app/forgot-password/` directory

## 6. Frontend

**6a. `apps/web/next-monorepo/apps/web/components/auth/LoginForm.tsx`** — delete the
"Forgot password?" `Link` block at lines 101–108. If `Link` becomes unused in the file, remove
that import too; `tsc` will tell you.

**6b. `apps/web/next-monorepo/apps/web/lib/backend-api.ts`** — in `changePassword` (line 427),
drop the email field from the input type, leaving the current password, new password, and
confirmation.

**6c. `apps/web/next-monorepo/apps/web/components/settings/SettingsScreen.tsx`** — at line 43,
delete the line that passes the user's email into the `changePassword` call, leaving the three
password fields.

## 7. Migration — the `PasswordReset` table (optional)

Remove the `PasswordReset` model and the `passwordResets` relation on `User` from
`apps/api/prisma/schema.prisma`, then run the migrate and generate commands in `apps/api`.

The table holds only hashed OTPs and reset tokens for expired attempts — no business data.
**Recommendation: skip this step for now.** Steps 1–6 are what remove the OTP, and leaving the
table costs nothing. If you skip it, also skip the `schema.prisma` edit so the schema and the
database stay in agreement.

## 8. Verification

Typecheck both apps: `npx tsc --noEmit` in `apps/api`, then in
`apps/web/next-monorepo/apps/web`.

With the database up (`docker start arcadelx-pg`) and the API running (`npm run dev` in
`apps/api`):

| Check | Expected |
| --- | --- |
| POST `/api/auth/forgot-password` | 404 |
| POST `/api/auth/verify-reset-otp` | 404 |
| POST `/api/auth/reset-password` | 404 |
| POST `/api/auth/login` | 200 |
| POST `/api/auth/change-password`, session + correct current password | 200 |
| POST `/api/auth/change-password`, wrong current password | 401 |
| POST `/api/auth/change-password`, **no session** | 401 |
| GET `/api/auth/me` immediately after a successful change | 401 |

The last two rows are the security assertions: the handler must refuse to act without a
session, and it must not leave the caller authenticated afterwards.

## Consequences

- **There is no self-service password recovery after this change**, and no admin reset endpoint
  exists either. The only ways to set a password are this handler and the temporary password
  emailed at registration. A user who forgets theirs currently has no route back in. If that
  matters, an admin-initiated reset becomes a prerequisite rather than a nice-to-have.
- The login page will no longer link to a page that does not exist.
- The six-character **invite code** on `/auth/join` and the twelve-character **temporary
  password** emailed at registration are untouched — you did not select those.

## Success looks like

No six-digit or OTP code anywhere in the password path; the change-password handler proves
identity from the session rather than a body field; the three reset routes 404; both typechecks
pass; the login page no longer links to a removed page.
