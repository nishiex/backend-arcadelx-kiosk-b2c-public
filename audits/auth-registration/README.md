# Registration repair verification

Current codebase verification: [owner contact integration](OWNER_CONTACT.md)
passes 204 combined checks and both registration-form component suites. The new
owner-contact migration is tested locally but not deployed to Supabase. The
deployment statements below describe the earlier registration-field repair.

The online revert removed Organization fields required by existing registration and Prisma defaults. `baseline.json` reproduces failure in a new local database. `verification.json` records 108 passing checks after repair. Tests use real handlers with captured Mailjet transport; no online test accounts or external emails are created.

`deployment.json` confirms the additive repair committed online and core Organization data fingerprints were preserved. Its new migration history row was inserted atomically; old migration history was not rewritten.

`running-verification.json` records live read-only checks, Mailjet authentication, matching repair checksum, and migration history. No local migration is pending; three remote-only migrations remain. Other historical schema drift is outside this repair.

Run from the repository root:

```powershell
node -r ./audits/auth-registration/runtime-loader.cjs audits/auth-registration/verify.cjs
node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/partner-registration-ui-check.tsx
node audits/auth-registration/check-running.cjs
npm run typecheck --workspace apps/api
```

The loader transpiles TypeScript in-process because sandbox restrictions block esbuild subprocesses. Integration tests require the ignored local environment backup and PostgreSQL on localhost:5433, creating a unique database per run. UI tests use the existing temporary jsdom installation.

API typecheck and Prisma validate passed. Native migrate status is blocked by spawn EPERM; SQL history checks are recorded instead. API lint has no script/configuration. Scoped frontend lint has no errors, with existing AddDistributor warnings. Frontend typecheck retains the unrelated dashboard/ui.tsx:130 KioskStatus mismatch.

Private environment changes restore verified saved Mailjet keys and use the responding port 5432 endpoint of the same online database. A private backup was saved outside source. No actual credential email was sent. Existing auth handlers, sessions, hashing and permissions were preserved. See [flow map](../AUTH_FLOW.md).
