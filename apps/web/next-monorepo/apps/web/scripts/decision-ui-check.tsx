// Component integration tests in an in-memory DOM; no browser or live API/data.
// npm install --prefix %TEMP%/arcadelx-ui-tests jsdom
// Run from repo root with tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json <this-file>
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const requireTest = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'))
const { JSDOM } = requireTest('jsdom')
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const w = dom.window
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'Event', 'CustomEvent', 'MouseEvent', 'FocusEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? w.getComputedStyle.bind(w) : w[key] })
}
w.matchMedia = (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { default: UsersScreen } = await import('../components/users/UsersScreen')
const { default: RequestsScreen } = await import('../components/requests/RequestsScreen')
const { default: OrdersScreen } = await import('../components/orders/OrdersScreen')
const calls: { path: string; method: string; body: unknown }[] = []
const evidence: { check: string; pass: boolean }[] = []
let role = 'ADMIN'
const org = { id: 'our-org', name: 'Our Company', type: 'COMPANY' }
const other = { id: 'other-org', name: 'Other Company', type: 'COMPANY' }
const readiness = { orderDecisions: false }
let readinessError = false
const members = Array.from({ length: 51 }, (_, i) => ({ id: `member-${i}`, status: 'PENDING', user: { name: `Applicant ${i}`, email: `member-${i}@example.invalid` } }))
const network = { id: 'network-1', status: 'PENDING', initiator: other, reciever: org, createdAt: new Date().toISOString() }
const agreement = { id: 'agreement-1', status: 'PENDING_APPROVAL', parentOrg: other, childOrg: org, parentSharePct: '60', childSharePct: '40', depositAmountPerMachine: 1000, nonRefundableAmountPerMachine: 200, createdAt: new Date().toISOString() }
const orders = [
  { id: 'order-1', orderNumber: 'ORD-TEST-1', type: 'REQUEST', status: 'UNDER_REVIEW', paymentStatus: 'PENDING', parentOrgId: org.id, childOrgId: other.id, parentOrg: org, childOrg: other, quantity: 1, createdAt: new Date().toISOString() },
  { id: 'order-2', orderNumber: 'ORD-TEST-2', type: 'REQUEST', status: 'UNDER_REVIEW', paymentStatus: 'PENDING', parentOrgId: other.id, childOrgId: org.id, parentOrg: other, childOrg: org, quantity: 1, createdAt: new Date().toISOString() },
]
const me = () => ({ id: 'user', name: 'Approver', membership: { status: 'ACTIVE', role, organizationId: org.id, organization: org } })
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  calls.push({ path: url.pathname + url.search, method, body })
  let data: unknown
  if (url.pathname === '/api/auth/me') data = { user: me() }
  else if (url.pathname === '/api/workflows') {
    if (readinessError) return new Response(JSON.stringify({ success: false, message: 'Readiness unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    data = readiness
  }
  else if (url.pathname === '/api/members/requests') {
    const page = Number(url.searchParams.get('page') ?? 1), limit = Number(url.searchParams.get('limit') ?? 50)
    const pending = members.filter(item => item.status === 'PENDING')
    data = { data: pending.slice((page - 1) * limit, page * limit), meta: { total: pending.length, page, limit, totalPages: Math.ceil(pending.length / limit) } }
  } else if (url.pathname.startsWith('/api/members/requests/')) {
    const member = members.find(item => url.pathname.endsWith('/' + item.id))!
    member.status = body.action === 'APPROVE' ? 'ACTIVE' : 'REJECTED'; data = null
  } else if (url.pathname === '/api/network') data = { requests: [network], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }
  else if (url.pathname === '/api/agreements') data = { agreements: [agreement], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } }
  else if (url.pathname.startsWith('/api/network/')) { network.status = url.pathname.endsWith('reject') ? 'REJECTED' : 'ACTIVE'; data = null }
  else if (url.pathname.startsWith('/api/agreements/')) { agreement.status = url.pathname.endsWith('reject') ? 'REJECTED' : 'ACTIVE'; data = null }
  else if (url.pathname === '/api/orders') data = { orders }
  else if (url.pathname.startsWith('/api/orders/')) { orders[0]!.status = url.pathname.endsWith('reject') ? 'REJECTED' : 'APPROVED'; data = null }
  else throw new Error(`Unexpected mocked request: ${url.pathname}`)
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
const check = (name: string, pass: boolean) => { evidence.push({ check: name, pass }); assert.ok(pass, name); console.log(name, 'PASS') }
async function until(test: () => boolean, description: string, timeout = 4000) {
  const deadline = Date.now() + timeout
  while (!test() && Date.now() < deadline) await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(test(), description)
}
async function render(Component: React.ComponentType) { await React.act(async () => root.render(<QueryClientProvider client={qc}><Component /></QueryClientProvider>)) }
async function click(button: Element | null) { assert.ok(button, 'Button exists'); await React.act(async () => (button as HTMLElement).click()) }
const byText = (name: string) => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === name) ?? null
try {
  qc.setQueryData(['pendingMembers', 1, 1], { data: [], meta: { total: 51 } })
  await render(UsersScreen)
  await until(() => document.querySelectorAll('li').length === 50, 'First member page loads')
  check('admin-dropdown-only-lower-roles', [...document.querySelectorAll('select')].every(select => [...select.options].map(option => option.value).join(',') === 'MANAGER,STAFF'))
  await click(byText('Next'))
  await until(() => document.querySelectorAll('li').length === 1 && document.body.textContent!.includes('Applicant 50'), 'Last member page loads')
  check('member-next-page-fetches-page-two', calls.some(call => call.path.includes('page=2&limit=50')))
  await click(byText('Approve'))
  await until(() => document.body.textContent!.includes('Page 1 of 1') && document.querySelectorAll('li').length === 50, 'Last-page approval returns to page 1')
  check('member-approval-uses-selected-role', calls.some(call => call.method === 'POST' && call.path.endsWith('/member-50') && (call.body as {role: string}).role === 'STAFF'))
  check('member-count-invalidated', qc.getQueryState(['pendingMembers', 1, 1])?.isInvalidated === true)
  await click(byText('Reject'))
  await until(() => document.querySelectorAll('li').length === 49, 'Rejection refreshes member list')
  check('member-rejection-removes-pending-row', members[0]!.status === 'REJECTED')
  const countBefore = calls.filter(call => call.path.startsWith('/api/members/requests?')).length
  await until(() => calls.filter(call => call.path.startsWith('/api/members/requests?')).length > countBefore, 'Member polling fires', 12_000)
  check('member-list-polls', true)
  await React.act(async () => { role = 'OWNER'; qc.setQueryData(['me'], me()) })
  await until(() => !!document.querySelector('option[value="ADMIN"]'), 'Owner role update reaches member dropdown')
  check('owner-can-select-admin', !!document.querySelector('option[value="ADMIN"]'))

  await render(RequestsScreen)
  await until(() => !!document.querySelector('[aria-label="Reject Connection from Other Company"]'), 'Network controls appear')
  await click(document.querySelector('[aria-label="Reject Connection from Other Company"]'))
  await until(() => !!document.querySelector('[role="dialog"]'), 'Confirmation dialog opens')
  check('network-rejection-explains-history-retention', document.querySelector('[role="dialog"]')!.textContent!.includes('kept in your history'))
  await click([...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Reject') ?? null)
  await until(() => !document.querySelector('[role="dialog"]') && document.body.textContent!.includes('REJECTED'), 'Network rejection updates list')
  check('network-rejection-sends-correct-endpoint', calls.some(call => call.path === '/api/network/network-1/reject' && call.method === 'POST'))
  await React.act(async () => { role = 'ADMIN'; qc.setQueryData(['me'], me()) })
  await click(byText('Agreements'))
  await until(() => document.body.textContent!.includes('Deposit / kiosk'), 'Agreement terms load')
  check('agreement-admin-cannot-decide', !document.querySelector('[aria-label="Approve Agreement from Other Company"]'))
  await React.act(async () => { role = 'OWNER'; qc.setQueryData(['me'], me()) })
  await until(() => !!document.querySelector('[aria-label="Reject Agreement from Other Company"]'), 'Owner gets agreement controls')
  await click(document.querySelector('[aria-label="Reject Agreement from Other Company"]'))
  await until(() => !!document.querySelector('[role="dialog"]'), 'Agreement confirmation opens')
  await click([...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Reject') ?? null)
  await until(() => agreement.status === 'REJECTED' && !document.querySelector('[role="dialog"]'), 'Agreement rejected')
  check('agreement-rejection-uses-patch', calls.some(call => call.path === '/api/agreements/agreement-1/reject' && call.method === 'PATCH'))

  await render(OrdersScreen)
  await until(() => !!document.querySelector('[aria-label="Approve ORD-TEST-1"]'), 'Order actions render')
  check('order-unavailable-controls-disabled', (document.querySelector('[aria-label="Approve ORD-TEST-1"]') as HTMLButtonElement).disabled)
  check('no-order-actions-for-other-supplier', !document.querySelector('[aria-label="Approve ORD-TEST-2"]'))
  await React.act(async () => { readiness.orderDecisions = true; await qc.invalidateQueries({ queryKey: ['workflow-readiness'] }) })
  await until(() => !(document.querySelector('[aria-label="Approve ORD-TEST-1"]') as HTMLButtonElement).disabled, 'Order readiness enables actions')
  for (const action of ['Approve', 'Reject']) {
    await click(document.querySelector(`[aria-label="${action} ORD-TEST-1"]`))
    await until(() => !!document.querySelector('[role="dialog"]'), `${action} confirmation opens before readiness failure`)
    const decisionCallsBefore = calls.filter(call => call.path.startsWith('/api/orders/') && call.method === 'POST').length
    await React.act(async () => { readinessError = true; await qc.invalidateQueries({ queryKey: ['workflow-readiness'] }) })
    await until(() => document.body.textContent!.includes("Couldn't check order action availability."), 'Readiness refetch error renders')
    check(`${action}-readiness-error-retains-enabled-cache`, qc.getQueryData<{ orderDecisions: boolean }>(['workflow-readiness'])?.orderDecisions === true)
    check(`${action}-readiness-error-disables-both-order-triggers`, ['Approve', 'Reject'].every(label => (document.querySelector(`[aria-label="${label} ORD-TEST-1"]`) as HTMLButtonElement).disabled))
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === action)!
    check(`${action}-readiness-error-disables-open-confirmation`, confirm.disabled)
    await click(confirm)
    check(`${action}-readiness-error-sends-no-decision`, calls.filter(call => call.path.startsWith('/api/orders/') && call.method === 'POST').length === decisionCallsBefore)
    await React.act(async () => { readinessError = false; await qc.invalidateQueries({ queryKey: ['workflow-readiness'] }) })
    await until(() => !confirm.disabled, `${action} confirmation recovers after successful readiness refetch`)
    await click(byText('Cancel'))
  }
  await click(document.querySelector('[aria-label="Approve ORD-TEST-1"]'))
  await until(() => !!document.querySelector('[role="dialog"]'), 'Order confirmation opens')
  check('order-approval-explains-reservation', document.querySelector('[role="dialog"]')!.textContent!.includes('reserved'))
  await click([...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'Approve') ?? null)
  await until(() => !document.querySelector('[aria-label="Approve ORD-TEST-1"]'), 'Approved order has no decision controls')
  check('order-approval-refreshes-row', orders[0]!.status === 'APPROVED')
} finally {
  fs.writeFileSync(path.join(process.cwd(), 'audits/approval-rejection-ui.json'), JSON.stringify({ simulatedDOM: true, liveDataUsed: false, evidence }, null, 2))
  await React.act(async () => root.unmount())
  qc.clear()
  dom.window.close()
}
process.exit(0)
