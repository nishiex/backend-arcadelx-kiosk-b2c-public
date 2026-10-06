# Local distributor order check — 2026-10-06

Verified through the running frontend proxy at http://localhost:3000 using Demo Pune Distribution's Owner login. Root DATABASE_URL was checked as localhost:5433/arcadelx_local. No credentials or cookies are recorded here.

| Check | Result |
| --- | --- |
| Login | HTTP 200 |
| GET /api/workflows | HTTP 200; orderDecisions, networkRejection and agreementRejection true |
| GET /api/agreements | HTTP 200; empty agreements, total 0 |
| GET /api/network | HTTP 200; empty requests, total 0 |
| POST /api/orders/create | HTTP 403; Cannot create order: No active agreement exists between these organizations |

The attempted request was type REQUEST, quantity 1, addressed to the existing local Company, ArcadeLX Local (6351a611-4c86-4f60-8dfc-fd1701031347). The handler rejects before creating an order or changing inventory. The verification session was logged out afterward.

Source verification: Distributor OWNER/ADMIN can access order creation. The handler requires an ACTIVE agreement plus the exact ACTIVE Company-to-Distributor network connection. The UI's CreateOrderDialog selects companies meeting both requirements and disables submission when none qualify. This was an HTTP/source check, not a browser interaction test.

No network or financial agreement was invented. The newly seeded demo distributors intentionally had only organization/owner/membership records. Demo Pune therefore cannot submit an order yet. Establish the Company connection and agree/approve financial terms first, then rerun a successful request test.

An earlier direct database preflight stalled and was interrupted before it reached its HTTP requests. The completed check above used the already-running application.
