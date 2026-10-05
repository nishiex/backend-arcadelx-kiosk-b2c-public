# Order requests restored — 2026-10-05

The configured online database had a completed lifecycle migration record but
was missing `Kiosk.reservedOrderId`, `OrderSequence`, and `EmailDelivery`. Its
history also contains remote-only `20261005071443_revert_teammate_changes`;
that migration's source was unavailable in this checkout. The application
correctly returned `orderDecisions: false` and disabled requests/decisions.

After the user requested restoring the functionality, the new additive migration
`20261005120000_restore_order_workflow` restored just the order prerequisites,
reservation FK/check, and one-open-assignment index. It seeds order counters
from existing standard-format order numbers without lowering existing counters.
It does not recreate Organization profile/access columns removed separately,
modify auth/role rules, change frontend gates, or rewrite historical migrations.
The user's pre-existing schema edit remains untouched.

All twelve existing consistency preflight counts were zero through both runtime
and direct database URLs. The deployment matched those endpoints' migration
histories and business-data fingerprints, then locked the order/stock tables.
Schema repair and its new Prisma migration-history row committed in one
transaction, using the exact checksum verified locally. Fingerprints before and
after matched for every existing business table (excluding the newly added
reservation pointer). Ten existing reserved kiosks received the derived pointer
to their already-approved order. No orders, amounts, statuses, owners, users,
memberships, agreements, or assignment-history rows were changed.

## Verification

- `node audits/order-readiness/verify.cjs`: four isolated local databases passed:
  reverted schema restored; current schema preserved; incorrect active-order
  quantity rejected with full rollback; orphan reserved stock rejected with full
  rollback. Tests also cover repeated application, counter preservation, and
  transactional request/rejection/email-queue SQL against the repaired schema.
- API typecheck and `prisma validate`: passed.
- Read-only authenticated GET `/api/workflows`, via both `localhost:4000` and
  the frontend proxy on `localhost:3000`: HTTP 200, `orderDecisions: true`.
- One Distributor currently has the active Company agreement/network combination
  required to submit a request. Existing relationship/role requirements still apply.
- No real orders or emails were created as verification. Frontend polling should
  clear the unavailable message within 30 seconds, or immediately after reload.
- Network/agreement rejection flags currently remain false, independently of
  order readiness. Those enum reversions were outside this repair.

Evidence: [verification.json](verification.json),
[deployment.json](deployment.json),
[running-verification.json](running-verification.json).

`verify.cjs` creates new local databases using the ignored local environment
backup; it does not use Docker API access, child-process helpers, or online data.
`deploy.cjs --apply-online` is the explicit deployment runner. It checks that
the repair is not already recorded and that the expected reverted schema still
matches; it is not a command to replay routinely. Older remote-only migrations
remain absent from this checkout; this repair does not reconcile their sources.
