# Request rejection enabled — 30 September 2026

The Requests banner was caused by missing REJECTED values in Supabase's
NetworkStatus and AgreementStatus enums. The existing frontend/backend correctly
disabled rejection when `/api/workflows` returned false.

The independent migration `20260930070000_request_rejections` is now applied and
registered with Prisma. Its entire SQL adds REJECTED to those two enum types.
No application code or historical migration file was changed, and no existing
request was approved/rejected as part of deployment.

## Review and rehearsal

The two enum types are used only by NetworkConnection.status and Agreement.status.
The observed constraints do not prohibit the new terminal value. This migration
does not depend on reserved-order columns, order sequences, email delivery tables
or the missing transaction migration source files.

The [local rehearsal](distributor-lifecycle/request-rejection-deployment-20260930080253048.json)
used the earlier schema with the order lifecycle migration absent, plus the same
historical migration names/checksums in an isolated test history. Both enum values
could be stored after the upgrade. Existing fixture rows were unchanged by the
DDL, and `prisma migrate resolve --applied` registered only this new migration
while leaving the older history entries intact. OrderSequence remained absent.
The preceding API rejection and agreement regression suites also passed; see
[the agreement audit](AGREEMENTS_REQUESTS_CHECK.md).

## Applied change

[Deployment evidence](distributor-lifecycle/request-rejection-deployment-20260930080347585.json)
records the reviewed checksum, enum values, row fingerprints and before/after
migration history. The exact SQL was applied in a transaction, with business-row
fingerprints verified unchanged before COMMIT. Session/reset-token tables were
excluded from fingerprints because authentication may legitimately update them;
the migration does not reference them.

Prisma registered only `20260930070000_request_rejections` using its supported
`migrate resolve --applied` command. All twelve pre-existing migration records
were preserved. No full `migrate deploy`, reset, history rewriting or fabricated
historical SQL was used.

## Verification

Authenticated calls through the frontend proxy now report:

```json
{
  "networkRejection": true,
  "agreementRejection": true,
  "orderDecisions": false
}
```

Agreement/network history reads succeeded, `/requests` returned HTTP 200, and the
existing agreement remained ACTIVE. All twelve [integrity preflight counts](distributor-lifecycle/preflight-20260930080434742.json)
are zero; no failed migrations exist. The new Prisma history checksum matches
the local SQL exactly. The verification login was logged out.

The banner clears when Requests refetches availability (every 30 seconds) or the
page is refreshed. Only receiving Owners can reject pending agreements; an ACTIVE
agreement still has no pending decision controls. Orders remain unavailable until
the separate lifecycle migration/history reconciliation is completed.
