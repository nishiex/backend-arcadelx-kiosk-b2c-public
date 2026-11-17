<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## IP screens (2026-11-17)

Only two IP routes exist: `/ip` (party list) and `/ip/new` (registration). The rest of the IP
API — games, daily revenue, settlements, royalty changes — has no UI yet. Do not assume a screen
exists because the endpoint does; check `app/(dashboard)/ip` before wiring anything.

The list carries a **Credentials** column: `Sent` / `Not delivered` from
`IpParty.credentialsEmailSent`, with a per-row Resend that calls `retryOrganizationCredentials`
(`POST /api/auth/organizations/:id/credentials/retry`). The registration toast branches on
`RegisteredIpParty.credentialsEmailSent` instead of always claiming an email was sent.
