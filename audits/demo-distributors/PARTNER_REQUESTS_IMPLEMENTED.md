# Distributor and Partner kiosk requests — 2026-10-06

Active Distributor and Partner Owners/Admins can now request kiosks. Distributor suppliers are Companies; Partner suppliers are Companies or Distributors linked through active agreements and active network connections. Quantity remains 1–50.

Backend /api/orders/create accepts Partner membership but explicitly rejects Partner ALLOCATION. Existing locked relationship validation, amount snapshots, UNDER_REVIEW/PENDING initial state and supplier-only approval/payment/dispatch/delivery are retained. No migration is needed.

Frontend exposes Orders to Partner Owners/Admins, enables their request action, reads all pages of supplier relationships, and uses Supplier labels. Other canTransact-dependent capabilities were not widened. The model selector remains draft-only, as before.

Verification:

- 25 real HTTP/Prisma checks passed on a newly created isolated local database. See partner-order-regression.json and partner-order-regression.cjs. Includes Distributor Owner/Admin, Partner Owner/Admin, Company/Distributor suppliers, denied allocation/approval, invalid quantities, inactive relationships, unrelated access, order amounts, no reservation/email side effects for requests.
- Updated order-request-ui-check.tsx passed permission, pagination, supplier filtering, validation, stale-readiness, failure/retry, duplicate-submit and successful Partner-to-Distributor submission tests with mocked HTTP.
- API TypeScript check passed. Full frontend TypeScript check still fails only on the pre-existing dashboard/ui.tsx:130 KioskStatus/RESERVED mismatch.
- Source diff whitespace checks passed. No external email, remote database mutation, or migration was performed.

This implements request permission and UI; it does not activate inactive demo accounts or create their network/agreement relationships. No Partner exists in the application local DB as of the preceding read-only check; end-to-end Partner requests were verified in the isolated regression database rather than with a browser session in the main app. Requests onboarding UI remains a separate known gap.
