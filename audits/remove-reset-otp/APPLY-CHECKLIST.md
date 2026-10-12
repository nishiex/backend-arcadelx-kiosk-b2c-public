# APPLY CHECKLIST — remove the 6-digit reset OTP

Verified against the working tree on 2026-10-09 at commit `5d5ea23`. Every line number below
was read from the file at that commit. Line numbers shift as you edit, so work **top to bottom**
within each file, or edit bottom-up within a file to keep earlier numbers valid.

Full rationale and consequences: `audits/remove-reset-otp/PATCH.md`.
Companion audit that lists this as P0 item 1: `audits/backend-improvements/backend-improvement-list.md`.

All files are **CRLF**.

Apply order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10. Steps 1–5 are the core removal;
the build is broken between step 5 and step 6, which is expected.

---

## 1. `apps/api/src/routes/auth.routes.ts`

**1a. Lines 10–12** — delete these three names from the import from
`"../controllers/auth.controller"` (the block spans lines 2–14). They are the only three
reset-related handlers in that import.

```
  forgotPassword,
  verifyResetOtp,
  completeForgotPassword,
```

**1b. Lines 52–54** — delete all three route registrations verbatim:

```ts
router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", completeForgotPassword);
```

Keep line 50 (`/change-password`) and line 56 (`export default router;`).

## 2. `apps/api/src/controllers/auth.controller.ts`

This is the file that could not be edited for me — the Safety Guard rejects the whole file
because of a pre-existing line at 358 (`const refreshToken = req.cookies.refresh_token;`, key
`Token`). It is a false positive; the value is a cookie read, not a credential.

**2a. Shared-types import (lines 13–21).** Remove the three reset schemas and rename the
remaining one:

- delete: `ResetPasswordSchema`, `ForgotPasswordSchema`, `VerifyResetOtpSchema`,
  `CompletePasswordResetSchema`
- add: `ChangePasswordSchema`

The block should then import exactly `RegisterOrgSchema`, `JoinOrgSchema`, `LoginSchema`,
`ChangePasswordSchema`.

**2b. Email import (lines 25–30).** Replace the two-name import from
`"../services/email/passwordreset.email"` with a single import of `sendPasswordChangedEmail`
from `"../services/email/password.email"` (the renamed file from step 7).

**2c. Util import (lines 31–35).** Delete the whole import from `"../utils/passwordReset"`
plus the blank line after it. Its three names — the OTP generator, the reset-token generator,
and the hash helper — are used only by the handlers removed in 2e.

**2d. Rewrite `changePassword` (lines 462–529).** This is a security fix, not cleanup. The
current version parses an email field out of the request body and looks the user up by it, and
never reads `req.user`. So a session for account A can change account B's password if it knows
B's current one.

Target behaviour, in order:

1. Parse the body with `ChangePasswordSchema` — it now yields only the current password and
   the new password (see step 3).
2. Look the user up by `req.user!.id`. Not by email, not from the body. Throw 404 if absent.
3. Compare the submitted current password against the stored hash; on mismatch throw
   `401 "Current password is incorrect"`.
4. If the new password matches the current one, throw `400`.
5. Keep the existing `prisma.$transaction` block as-is — it updates the stored hash and deletes
   that user's refresh tokens. Both statements are already correct; leave them untouched.
6. After the transaction, add `clearTokenCookies(res)`. It is already imported at line 22 and
   was previously unused in this handler, so this also clears the now-revoked caller cookies.
7. Add an `await sendPasswordChangedEmail({ email: user.email, name: user.name })` call. It is
   already imported but was never called anywhere. Since the old password is gone, notify.
8. Respond 200 with `null` data and message `"Password changed successfully. Please log in again."`

Note: steps 5 and 7 contain lines whose left-hand keys look like credentials, which is why this
file is write-blocked. Keep them from the existing code rather than retyping them.

**2e. Delete lines 530–788 (to EOF).** `forgotPassword` begins at 530 and is followed directly by
`verifyResetOtp` (597) and `completeForgotPassword` (702), running to the end of the file. One
cut removes all three. Line 529 is the closing `);` of `changePassword`, so it stays.

## 3. `packages/shared-types/validationSchemas/auth.validation.ts` (136 lines)

**3a. Replace lines 101–111** (`ResetPasswordSchema`) with `ChangePasswordSchema`. Three changes:
drop the email field, and swap the two inline 8-char minimums for the existing `passwordSchema`
constant so the 8–128 rule stays in one place. Keep the `newPassword`/`confirmPassword` match
refine exactly as it is (its two paths and messages are unchanged).

**3b. Delete lines 113–136** (to EOF): `ForgotPasswordSchema` (113–115), `VerifyResetOtpSchema`
(117–124, this is the one holding the six-digit regex), and `CompletePasswordResetSchema`
(126–136).

## 4. `apps/api/src/utils/passwordReset.ts`

Delete the file. It exports exactly three things — `generateOtp`, `generateResetToken`,
`hashResetValue` — and grep confirms nothing outside the handlers removed in 2e imports them.

## 5. `apps/web/next-monorepo/apps/web/app/forgot-password/page.tsx`
## and `apps/web/next-monorepo/apps/web/components/auth/ForgotPasswordForm.tsx`

Delete both files, then remove the now-empty `app/forgot-password/` directory. The form is a
three-step email → code → new-password flow, so nothing else can use it.

## 6. `apps/web/next-monorepo/apps/web/components/auth/LoginForm.tsx`

**Lines 103–108** — delete the whole `<Link href="/forgot-password"> … </Link>` block (the
label at 100–102 and the surrounding div at 99 and 109 stay). Then run `tsc`; if `Link` is now
unused in this file, drop it from the import.

## 7. `apps/api/src/services/email/passwordreset.email.ts` → rename

- Delete lines 9–13 (the OTP params type) and lines 15–59 (the OTP send function).
- Keep lines 61–64 (the changed-password params type) and 66+ (the changed-password send
  function) — this is the one step 2d now calls.
- Line 4 (`emailCredential`) is used only by the deleted OTP template. Remove it from the
  `email-theme` import at lines 2–7, or the build raises an unused-import error. It stays
  exported from `email-theme.ts` for the credentials email.
- Rename the file to `password.email.ts`, matching the import written in step 2b.

## 8. `apps/web/next-monorepo/apps/web/lib/backend-api.ts`

**Line 428** — delete `email: string;` from the `changePassword` input type (lines 427–432),
leaving the three password fields.

## 9. `apps/web/next-monorepo/apps/web/components/settings/SettingsScreen.tsx`

**Line 44** — delete the `email: me!.email,` argument from the `changePassword` call
(lines 43–48), leaving the three password fields.

## 10. Optional — drop the `PasswordReset` table

**Recommended: skip.** Steps 1–9 are what remove the OTP; the table holds only hashed OTPs and
reset tokens for expired attempts, so leaving it costs nothing and keeps `schema.prisma` in
agreement with the database.

If you do want it dropped, remove the `PasswordReset` model and the `passwordResets` relation
on `User` from `apps/api/prisma/schema.prisma`, then in `apps/api` run:

```
npx prisma migrate dev --name remove_password_reset_otp
npx prisma generate
```

---

## When you are done, tell me and I will verify

I will run, and report raw output for:

1. `npx tsc --noEmit` in `apps/api` — catches every dangling import from steps 1, 2 and 7.
2. `npx tsc --noEmit` in `apps/web/next-monorepo/apps/web` — catches steps 6, 8 and 9.
3. `POST /api/auth/forgot-password`, `/verify-reset-otp`, `/reset-password` → all must be **404**.
4. `POST /api/auth/login` → **200**.
5. `POST /api/auth/change-password` with a live session and the correct current password → **200**.
6. The same call again with the *old* password → **401**.
7. The same call with **no session at all** → **401** (proves identity now comes from the
   session, not the body).
8. `GET /api/auth/me` immediately after a successful change → **401** (proves the refresh
   tokens were revoked and cookies cleared).
9. A grep confirming no `otp` / `forgot` / `verifyResetOtp` references remain in
   `apps/api/src` or the frontend `app`/`components`/`lib` trees.

Rows 7 and 8 are the security assertions. Row 3 confirms the routes are gone rather than merely
returning 400 for a bad payload — which is what they do today.

## Consequences to be aware of

- **No self-service password recovery remains**, and there is no admin reset endpoint either.
  After this, the only ways to set a password are this handler and the temporary password
  emailed at registration. A user who forgets theirs has no route back in. That is the direct
  result of the choice, not an oversight.
- The six-character **invite code** on `/auth/join` and the twelve-character **temporary
  password** emailed at registration are untouched — those were not selected for removal.
- This also lands the `changePassword` identity fix, so the P0 item 1 in the backend audit is
  cleared along with it.
