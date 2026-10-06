# Partner review — 2026-10-06

Scope: current local workspace and arcadelx_local, including uncommitted changes. No business rows or migrations changed. No email sent.

## Verified

- Read-only local SQL: User.contact is absent; zero Partner organizations exist (partner-schema.json).
- Real registration component with mocked HTTP: all three reported test groups pass. Covered active Distributor OWNER/ADMIN permissions, denied roles/organizations/inactive memberships, input validation, API errors, duplicate-submit prevention, cookies, credential-email retry, modal lifecycle.
- Command: node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/partner-registration-ui-check.tsx

## Current blockers

1. New Partner registration requires ownerContact and queries User.contact. The absent local column means a request from an otherwise authorized parent reaches the explicit 503 migration-required response. The contact migration is checked in but was not applied in this review.
2. Both demo Distributor logins most recently returned inactive-account 403. They cannot register Partners in that state.
3. RequestsScreen exists but has no Next route/sidebar entry; /requests returned 404. Partner OWNER/ADMIN cannot accept network requests through this UI and Partner OWNER cannot approve agreements there.
4. No current frontend callers create network connections or draft agreements. Registration itself does not create either relationship.
5. PartnersScreen is a Distributor registration screen, not a list/detail management view of existing Partner organizations.
6. Backend supports Company-created Partners, but frontend canRegisterPartners is restricted to Distributors. Company-to-Partner onboarding is not exposed by that UI.

## Source-verified Partner behavior

- Partner cannot create organizations or initiate orders.
- Partner inventory reads are scoped to current ownership. Partner cannot batch-create kiosks or mutate kiosk status under current route policy.
- Partner OWNER/ADMIN may accept incoming network requests; only OWNER approves financial agreements.
- Partner OWNER/ADMIN/MANAGER may view revenue; deduction-rate changes require COMPANY OWNER/ADMIN.
- Sidebar exposes Overview, Kiosks, eligible Revenue and Settings; Orders is hidden for Partners. Backend still permits scoped read access to orders involving the Partner through GET endpoints.
- Parent Company/Distributor must allocate machines and complete delivery before they become Partner-owned inventory.

These policies were traced through useMe, Sidebar, inventory hooks, API routes and agreement/order controllers. No actual Partner login, kiosk transfer or financial statement lifecycle was run because no local Partner account exists. A passing mocked registration test is not an end-to-end onboarding result or visual browser QA.

Conclusion: registration UI has tested behavior, but local schema and relationship-onboarding UI must be completed before calling the Partner flow ready.
