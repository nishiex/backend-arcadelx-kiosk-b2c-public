// Real components + mocked HTTP in an in-memory DOM; no live API or database writes.
// Run from the repo root with the auth-registration runtime loader:
//   node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/distributor-agreement-ui-check.tsx
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const requireTest = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'))
const { JSDOM } = requireTest('jsdom')
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const w = dom.window
for (const key of ['window', 'self', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'Event', 'CustomEvent', 'FocusEvent', 'MouseEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? w.getComputedStyle.bind(w) : w[key] })
}
w.matchMedia = (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js')
const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js')
const { default: DistributorsScreen } = await import('../components/distributors/DistributorsScreen')
const { default: Sidebar } = await import('../components/dashboard/Sidebar')
const { gsap, ScrollTrigger } = await import('../lib/gsap')

const company = { id: 'company-1', name: 'ArcadeLX', type: 'COMPANY' }
/** No connection at all — the case the live local database is full of. */
const unconnected = {
  id: 'dist-1', name: 'Unconnected Distributor', isActive: true, statusManagementAvailable: true,
  type: 'DISTRIBUTOR', city: 'Pune', state: 'Maharashtra', pincode: 411001,
  gstNumber: null, phone: null, country: 'India', createdAt: '2026-10-01T00:00:00.000Z',
  owner: { id: 'owner-1', name: 'Dist Owner', email: 'owner1@example.invalid' },
  _count: { kiosks: 0, memberships: 1 },
}
/** Already connected with live terms, including a Decimal-as-string share. */
const connected = {
  ...unconnected, id: 'dist-2', name: 'Connected Distributor', city: 'Mumbai',
  owner: { id: 'owner-2', name: 'Dist Owner Two', email: 'owner2@example.invalid' },
}
/** A rejected request must not read as "never asked". */
const declined = {
  ...unconnected, id: 'dist-3', name: 'Declined Distributor',
  owner: { id: 'owner-3', name: 'Dist Owner Three', email: 'owner3@example.invalid' },
}

let role = 'OWNER'
const me = () => ({ id: 'user-1', name: 'Owner', email: 'owner@example.invalid', permissions: [], membership: { status: 'ACTIVE', role, organizationId: company.id, organization: company } })

let connections: { id: string; status: string; initiatorOrgId: string; receiverOrgId: string; initiator: typeof company; reciever: { id: string; name: string; type: string }; createdAt: string }[] = [
  { id: 'conn-2', status: 'ACTIVE', initiatorOrgId: company.id, receiverOrgId: 'dist-2', initiator: company, reciever: { id: 'dist-2', name: connected.name, type: 'DISTRIBUTOR' }, createdAt: '2026-10-02T00:00:00.000Z' },
  { id: 'conn-3', status: 'REJECTED', initiatorOrgId: company.id, receiverOrgId: 'dist-3', initiator: company, reciever: { id: 'dist-3', name: declined.name, type: 'DISTRIBUTOR' }, createdAt: '2026-10-03T00:00:00.000Z' },
]
let agreements: {
  id: string; status: string; networkConnectionId: string; parentOrgId: string; childOrgId: string
  parentSharePct: string | number; childSharePct: string | number
  effectiveFrom: string; effectiveTo: string | null; depositAmountPerMachine: number | string
  nonRefundableAmountPerMachine: number | string; pdfUrl: string | null; createdAt: string
  parentOrg: typeof company; childOrg: { id: string; name: string; type: string }
}[] = [
  {
    id: 'agreement-2', status: 'ACTIVE', networkConnectionId: 'conn-2', parentOrgId: company.id, childOrgId: 'dist-2',
    parentSharePct: '40', childSharePct: '60', effectiveFrom: '2026-10-02T00:00:00.000Z', effectiveTo: null,
    depositAmountPerMachine: 10000, nonRefundableAmountPerMachine: 2000, pdfUrl: null,
    createdAt: '2026-10-02T00:00:00.000Z', parentOrg: company, childOrg: { id: 'dist-2', name: connected.name, type: 'DISTRIBUTOR' },
  },
]
const calls: { path: string; method: string; body: unknown }[] = []
const evidence: { check: string; pass: boolean }[] = []

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ path: url.pathname + url.search, method, body })
  let data: unknown
  if (url.pathname === '/api/auth/me') data = { user: me() }
  else if (url.pathname === '/api/network/distributors') data = { distributors: [unconnected, connected, declined] }
  else if (url.pathname === '/api/network') data = { requests: connections, meta: { total: connections.length, page: 1, limit: 50, totalPages: 1 } }
  else if (url.pathname === '/api/agreements') data = { agreements, meta: { total: agreements.length, page: 1, limit: 20, totalPages: 1 } }
  else if (url.pathname === '/api/network/initiate') {
    const target = [unconnected, connected, declined].find(row => row.owner?.email === (body as { targetOwnerEmail: string }).targetOwnerEmail)!
    connections = [...connections.filter(row => row.receiverOrgId !== target.id), { id: `conn-${target.id}`, status: 'PENDING', initiatorOrgId: company.id, receiverOrgId: target.id, initiator: company, reciever: { id: target.id, name: target.name, type: 'DISTRIBUTOR' }, createdAt: '2026-10-06T00:00:00.000Z' }]
    data = { connection: { id: `conn-${target.id}` } }
  } else if (url.pathname === '/api/agreements/create') {
    const terms = body as { childOrgId: string; networkConnectionId: string; parentSharePct: number; childSharePct: number; depositAmountPerMachine: number; nonRefundableAmountPerMachine: number }
    const child = [unconnected, connected, declined].find(row => row.id === terms.childOrgId)!
    // Decimal columns are returned as strings, matching the live API.
    agreements = [{
      ...agreements[0]!, ...terms, id: `agreement-${terms.childOrgId}`, status: 'PENDING_APPROVAL',
      parentSharePct: String(terms.parentSharePct), childSharePct: String(terms.childSharePct),
      childOrg: { id: child.id, name: child.name, type: 'DISTRIBUTOR' },
    }, ...agreements]
    data = { agreement: agreements[0] }
  } else if (url.pathname.startsWith('/api/agreements/') && url.pathname.endsWith('/terminate')) {
    const id = url.pathname.split('/')[3]!
    agreements = agreements.map(row => row.id === id ? { ...row, status: 'TERMINATED' } : row)
    data = null
  } else throw new Error(`Unexpected mocked request: ${url.pathname}`)
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
const router = { bfcacheId: 'test', back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch: async () => {} }
const check = (name: string, pass: boolean) => { evidence.push({ check: name, pass }); assert.ok(pass, name); console.log(name, 'PASS') }
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function until(test: () => boolean, description: string, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!test() && Date.now() < deadline) await flush()
  assert.ok(test(), description)
}
async function render(component: React.ReactNode) {
  await React.act(async () => {
    root.render(<QueryClientProvider client={qc}><AppRouterContext.Provider value={router}><PathnameContext.Provider value="/">{component}</PathnameContext.Provider></AppRouterContext.Provider></QueryClientProvider>)
  })
  await flush()
}
async function identity() { await React.act(async () => { qc.setQueryData(['me'], me()) }); await flush() }
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text) ?? null
async function click(element: Element | null) { assert.ok(element, 'Target element exists'); await React.act(async () => (element as HTMLElement).click()); await flush() }
async function fill(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement
  assert.ok(input, `Input ${id} exists`)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}
async function submitForm() {
  await React.act(async () => { document.querySelector('[role="dialog"] form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) })
  await flush()
}
const requestDialog = () => document.querySelector('[role="dialog"]')
const agreementCalls = () => calls.filter(call => call.path.startsWith('/api/agreements/'))

try {
  // 1. An ADMIN can manage distributors but must not draft financial agreements.
  role = 'ADMIN'
  await identity()
  await render(<DistributorsScreen />)
  await until(() => !!document.querySelector('[aria-label="Deactivate Unconnected Distributor"]'), 'Distributor rows load')
  check('admin-still-gets-status-controls', !!document.querySelector('[aria-label="Deactivate Unconnected Distributor"]'))
  check('admin-cannot-open-agreement-action', !document.querySelector('[aria-label="Agreement for Unconnected Distributor"]'))

  // 2. The OWNER gets the action.
  role = 'OWNER'
  await identity()
  await until(() => !!document.querySelector('[aria-label="Agreement for Unconnected Distributor"]'), 'Owner gets the agreement action')

  // 3. A distributor with no connection cannot draft terms — the API requires an
  //    ACTIVE connection initiated by this organization.
  await click(document.querySelector('[aria-label="Agreement for Unconnected Distributor"]'))
  await until(() => requestDialog()!.textContent!.includes('No active network connection exists yet'), 'Missing connection is explained')
  check('no-terms-form-without-connection', button('Send for approval') === null)
  check('connection-request-targets-owner-email', requestDialog()!.textContent!.includes('owner1@example.invalid'))

  // 4. Sending the request uses the documented endpoint and payload.
  await click(button('Send connection request'))
  const initiated = calls.find(call => call.path === '/api/network/initiate')!
  check('initiate-payload-matches-api-contract', initiated?.method === 'POST' && (initiated.body as { targetOwnerEmail: string }).targetOwnerEmail === 'owner1@example.invalid')
  await until(() => requestDialog()!.textContent!.includes("A connection request is awaiting this distributor's decision"), 'Pending state shown after sending')
  check('pending-connection-explains-waiting', button('Send for approval') === null)

  // 5. A declined request is not presented as never asked.
  await click(document.querySelector('[aria-label="Close agreement"]'))
  await click(document.querySelector('[aria-label="Agreement for Declined Distributor"]'))
  await until(() => requestDialog()!.textContent!.includes('declined the previous connection request'), 'Declined connection is explained')
  await click(document.querySelector('[aria-label="Close agreement"]'))

  // 6. Once the receiver accepts, terms can be drafted. The mock flips the
  //    connection the same way the recipient's acceptance would.
  await click(document.querySelector('[aria-label="Agreement for Unconnected Distributor"]'))
  await until(() => requestDialog()!.textContent!.includes('awaiting this distributor'), 'Pending dialog reopened')
  await React.act(async () => {
    connections = connections.map(row => row.receiverOrgId === 'dist-1' ? { ...row, status: 'ACTIVE' } : row)
    await qc.invalidateQueries({ queryKey: ['network-connections'] })
  })
  await until(() => !!document.getElementById('deposit-dist-1'), 'Terms form appears for an active connection')
  check('active-connection-reveals-terms-form', !!document.getElementById('parentShare-dist-1') && !!document.getElementById('nonRefundable-dist-1'))

  // 7. Shares that do not total 100 are rejected before any write.
  const createsBefore = agreementCalls().filter(call => call.method === 'POST').length
  await fill('childShare-dist-1', '50')
  await submitForm()
  check('shares-must-total-100', requestDialog()!.textContent!.includes('must total 100'))
  check('invalid-shares-send-no-request', agreementCalls().filter(call => call.method === 'POST').length === createsBefore)

  // 8. A valid submission matches the create contract exactly.
  await fill('childShare-dist-1', '40')
  await fill('deposit-dist-1', '10000')
  await fill('nonRefundable-dist-1', '2000')
  await submitForm()
  const created = agreementCalls().find(call => call.method === 'POST' && call.path === '/api/agreements/create')!
  assert.ok(created, 'Agreement create request was sent')
  check('create-payload-matches-api-contract', JSON.stringify(created.body) === JSON.stringify({
    childOrgId: 'dist-1', networkConnectionId: 'conn-dist-1', parentSharePct: 60, childSharePct: 40,
    depositAmountPerMachine: 10000, nonRefundableAmountPerMachine: 2000,
  }))
  await until(() => requestDialog()!.textContent!.includes('Awaiting approval'), 'Drafted agreement shows as awaiting approval')
  check('draft-is-not-treated-as-active', button('Terminate agreement') === null)

  // 9. Existing terms are displayed, with Decimal-as-string shares coerced.
  await click(document.querySelector('[aria-label="Close agreement"]'))
  await click(document.querySelector('[aria-label="Agreement for Connected Distributor"]'))
  await until(() => requestDialog()!.textContent!.includes('Current agreement'), 'Existing agreement summary loads')
  check('existing-decimal-shares-render', requestDialog()!.textContent!.includes('40%') && requestDialog()!.textContent!.includes('60%'))
  check('existing-terms-render-money', requestDialog()!.textContent!.includes('10,000') && requestDialog()!.textContent!.includes('2,000'))
  check('active-agreement-offers-termination', button('Terminate agreement') !== null)
  check('draft-form-hidden-while-agreement-open', button('Send for approval') === null)

  // 10. Termination uses the documented DELETE endpoint and updates the summary.
  await click(button('Terminate agreement'))
  check('terminate-uses-delete-endpoint', agreementCalls().some(call => call.path === '/api/agreements/agreement-2/terminate' && call.method === 'DELETE'))
  await until(() => requestDialog()!.textContent!.includes('Agreement terminated for both organizations'), 'Terminated state is confirmed')

  // 11. The receiving Owner needs a reachable route to approve the draft.
  check('requests-route-exists', fs.existsSync(path.join(process.cwd(), 'apps/web/next-monorepo/apps/web/app/(dashboard)/requests/page.tsx')))
  await React.act(async () => { role = 'OWNER'; qc.setQueryData(['me'], me()) })
  await render(<Sidebar />)
  check('owner-gets-requests-link', !!document.querySelector('a[href="/requests"]'))
  await React.act(async () => { role = 'MANAGER'; qc.setQueryData(['me'], me()) })
  await render(<Sidebar />)
  check('manager-has-no-requests-link', !document.querySelector('a[href="/requests"]'))
} finally {
  fs.writeFileSync(path.join(process.cwd(), 'audits/distributor-agreement-ui.json'), JSON.stringify({ simulatedDOM: true, liveDataUsed: false, evidence }, null, 2))
  await React.act(async () => root.unmount())
  qc.clear(); ScrollTrigger.disable(); gsap.ticker.sleep(); dom.window.close()
}
process.exit(0)
