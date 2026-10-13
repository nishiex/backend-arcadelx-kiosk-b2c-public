// Component checks for the two gaps filled on 2026-10-07: the header bell now counts
// every pending queue, and orders under review can be rejected from the UI.
//
// Real components + mocked HTTP in an in-memory DOM; no live API or database writes.
// Run from the repo root with the auth-registration runtime loader:
//   node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/notifications-and-order-reject-ui-check.tsx
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
const { default: Header } = await import('../components/dashboard/Header')
const { ThemeProvider } = await import('../components/theme-provider')
const { default: OrderStatusDialog, nextStep } = await import('../components/orders/OrderStatusDialog')
const { gsap, ScrollTrigger } = await import('../lib/gsap')
type OrgRef = { id: string; name: string; type: 'COMPANY' | 'DISTRIBUTOR' | 'PARTNER' }

const company: OrgRef = { id: 'company-1', name: 'ArcadeLX', type: 'COMPANY' }
const other: OrgRef = { id: 'other-1', name: 'Distributor', type: 'DISTRIBUTOR' }

let role = 'OWNER'
let orgType = 'COMPANY'
const me = () => ({ id: 'user-1', name: 'Owner', email: 'owner@example.invalid', permissions: [], membership: { status: 'ACTIVE', role, organizationId: company.id, organization: { ...company, type: orgType } } })

type Pending = { pendingMembers: number; pendingConnections: number; pendingAgreements: number; ordersUnderReview: number; orderDecisions: boolean; hold?: boolean }
let state: Pending = { pendingMembers: 0, pendingConnections: 0, pendingAgreements: 0, ordersUnderReview: 0, orderDecisions: true }
const calls: { path: string; method: string }[] = []
const evidence: { check: string; pass: boolean }[] = []

const order = (id: string, status: string, paymentStatus: string, parentOrgId: string) => ({
  id, orderNumber: `ORD-${id}`, type: 'REQUEST' as const, status: status as never, paymentStatus: paymentStatus as never,
  parentOrgId, childOrgId: other.id, parentOrg: company, childOrg: other, quantity: 1, requestedModel: null,
  depositPerMachine: 10000, nonRefundablePerMachine: 2000, totalDeposit: 10000, totalNonRefundable: 2000,
  taxAmount: 360, grandTotal: 12360,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
})

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  calls.push({ path: url.pathname + url.search, method })
  let data: unknown
  if (url.pathname === '/api/auth/me') data = { user: me() }
  else if (url.pathname === '/api/workflows') data = { orderDecisions: state.orderDecisions }
  else if (url.pathname === '/api/members/requests') data = { data: [], meta: { total: state.pendingMembers, page: 1, limit: 1, totalPages: 1 } }
  else if (url.pathname === '/api/network') {
    const rows = Array.from({ length: state.pendingConnections }, (_, i) => ({
      id: `conn-${i}`, status: 'PENDING', from: other, to: company, createdAt: '2026-10-01T00:00:00.000Z',
      initiator: other, reciever: company,
    }))
    data = { requests: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } }
  } else if (url.pathname === '/api/agreements') {
    const rows = Array.from({ length: state.pendingAgreements }, (_, i) => ({
      id: `agr-${i}`, status: 'PENDING_APPROVAL', from: other, to: company, createdAt: '2026-10-01T00:00:00.000Z',
      parentOrg: other, childOrg: company,
    }))
    data = { agreements: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } }
  } else if (url.pathname === '/api/orders') {
    const rows = Array.from({ length: state.ordersUnderReview }, (_, i) => order(`0000${i}`, 'UNDER_REVIEW', 'PENDING', company.id))
    data = { orders: rows }
  } else if (url.pathname.endsWith('/reject')) {
    data = { order: order('reject1', 'REJECTED', 'PENDING', company.id) }
  } else if (url.pathname === '/api/kiosks/summary') data = { summary: {} }
  else if (url.pathname === '/api/kiosks') data = { kiosks: [] }
  else if (url.pathname === '/api/revenue/series') data = { range: '30d', granularity: 'Daily', bucket: 'day', currency: 'INR', total: 0, points: [] }
  else if (url.pathname.startsWith('/api/orders/')) data = { order: order('x', 'APPROVED', 'PAID', company.id) }
  else throw new Error(`Unexpected mocked request: ${url.pathname}`)
  if (state.hold && url.pathname === '/api/orders') await new Promise(resolve => setTimeout(resolve, 400))
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
    // Header renders ThemeToggle, which requires the app's ThemeProvider.
    root.render(<QueryClientProvider client={qc}><ThemeProvider><AppRouterContext.Provider value={router}><PathnameContext.Provider value="/">{component}</PathnameContext.Provider></AppRouterContext.Provider></ThemeProvider></QueryClientProvider>)
  })
  await flush()
}
/** Fresh cache per scenario so one case cannot seed another. */
async function identity(nextRole: string, nextOrgType = 'COMPANY') {
  role = nextRole
  orgType = nextOrgType
  await React.act(async () => {
    qc.clear()
    qc.setQueryData(['me'], me())
  })
  await flush()
}
const bell = () => document.querySelector<HTMLButtonElement>('[aria-label^="Notifications"]')
const badge = () => document.querySelector('[data-badge]')?.textContent?.trim() ?? null
const panelText = () => {
  const panel = [...document.querySelectorAll('div')].find(el => el.textContent?.startsWith('Pending work'))
  // jsdom does not implement innerText, so read textContent.
  return panel ? (panel.textContent ?? '').replace(/\s+/g, ' ').trim() : ''
}
/**
 * Each notice is a list item holding a link (label + target) and a count span. Read
 * them structurally: the label and count are separate elements, so textContent
 * concatenates them with no separator.
 */
const noticeRows = () => [...document.querySelectorAll('li')]
  .map(li => {
    const link = li.querySelector('a')
    if (!link) return null
    const counts = [...li.querySelectorAll('span')].map(span => span.textContent?.trim()).filter(Boolean)
    return { label: link.textContent?.trim() ?? '', count: counts[counts.length - 1] ?? null, href: link.getAttribute('href') }
  })
  .filter((row): row is { label: string; count: string | null; href: string | null } => row !== null)
const notice = (label: string) => noticeRows().find(row => row.label === label)
// The bell's open state lives in the component and survives a re-render, so make
// opening/closing idempotent instead of blindly toggling.
async function openBell() {
  if (panelText()) return
  await React.act(async () => bell()!.click())
  await flush()
}
async function closeBell() {
  if (!panelText()) return
  await React.act(async () => bell()!.click())
  await flush()
}
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text) ?? null
async function click(element: Element | null) { assert.ok(element, 'Target exists'); await React.act(async () => (element as HTMLElement).click()); await flush() }

try {
  // ---- 1. Every queue empty: the bell may say there is nothing to do.
  state = { pendingMembers: 0, pendingConnections: 0, pendingAgreements: 0, ordersUnderReview: 0, orderDecisions: true }
  await identity('OWNER')
  await render(<Header />)
  await until(() => !!bell(), 'Bell renders for an Owner')
  check('bell-hidden-badge-when-nothing-pending', badge() === null)
  await openBell()
  check('all-clear-only-when-every-queue-empty', panelText().includes("You're all caught up"))

  // ---- 2. The reported defect: orders under review must be counted.
  state = { ...state, ordersUnderReview: 2 }
  await identity('OWNER')
  await render(<Header />)
  await until(() => badge() === '2', 'Badge reflects the two orders under review')
  check('counts-orders-awaiting-approval', badge() === '2')
  await openBell()
  check('names-the-queue-and-links-it', notice('Orders awaiting approval')?.count === '2')
  check('order-notice-links-to-orders', notice('Orders awaiting approval')?.href === '/orders')
  check('does-not-claim-all-clear-with-work-pending', !panelText().includes('all caught up'))

  // ---- 3. Every queue contributes, and the total is their sum.
  state = { pendingMembers: 1, pendingConnections: 3, pendingAgreements: 2, ordersUnderReview: 4, orderDecisions: true }
  await identity('OWNER')
  await render(<Header />)
  await flush()
  await until(() => badge() === '10', 'Badge is the sum of all queues')
  check('badge-sums-every-queue', badge() === '10')
  await openBell()
  check('lists-members-connections-agreements-orders',
    notice('Member requests')?.count === '1' &&
    notice('Connection requests')?.count === '3' &&
    notice('Agreements to approve')?.count === '2' &&
    notice('Orders awaiting approval')?.count === '4')
  check('member-notice-links-to-user', notice('Member requests')?.href === '/user')
  check('connection-and-agreement-notices-link-to-requests',
    notice('Connection requests')?.href === '/requests' && notice('Agreements to approve')?.href === '/requests')
  await closeBell()

  // ---- 4. A queue still loading must never read as nothing to do.
  state = { pendingMembers: 0, pendingConnections: 0, pendingAgreements: 0, ordersUnderReview: 1, orderDecisions: true, hold: true }
  await identity('OWNER')
  await render(<Header />)
  await until(() => !!bell(), 'Bell renders while a queue is in flight')
  await openBell()
  check('loading-state-not-mistaken-for-empty', !panelText().includes('all caught up'))
  check('loading-state-is-explicit', /checking for pending work/i.test(panelText()))
  state.hold = false

  // ---- 5. Order lifecycle steps are unaffected by the reject addition.
  check('approved-unpaid-step-is-record-payment', nextStep(order('a', 'APPROVED', 'PENDING', company.id))?.button === 'Mark as paid')
  check('approved-paid-step-is-dispatch', nextStep(order('b', 'APPROVED', 'PAID', company.id))?.button === 'Dispatch')
  check('dispatched-step-is-deliver', nextStep(order('c', 'DISPATCHED', 'PAID', company.id))?.button === 'Mark delivered')
  check('delivered-has-no-next-step', nextStep(order('d', 'DELIVERED', 'PAID', company.id)) === null)

  // ---- 6. Rejection is offered only for an unpaid request under review.
  const underReview = order('r1', 'UNDER_REVIEW', 'PENDING', company.id)
  await render(<OrderStatusDialog order={underReview} disabled={false} />)
  await until(() => !!document.querySelector('[aria-label="Reject ORD-r1"]'), 'Reject is offered for an under-review request')
  check('reject-offered-for-under-review', !!document.querySelector('[aria-label="Reject ORD-r1"]'))
  check('no-forward-step-offered-under-review', button('Approve') === null)
  await click(document.querySelector('[aria-label="Reject ORD-r1"]'))
  await until(() => !!document.querySelector('[role="dialog"]'), 'Rejection confirmation opens')
  const dialogText = document.querySelector('[role="dialog"]')!.textContent ?? ''
  check('rejection-explains-no-stock-moves', /no stock moves/i.test(dialogText))
  check('rejection-explains-history-is-kept', /history/i.test(dialogText))
  const before = calls.filter(call => call.method === 'PATCH').length
  await click([...document.querySelectorAll('[role="dialog"] button')].find(el => el.textContent === 'Reject') ?? null)
  await flush()
  await until(() => calls.filter(call => call.method === 'PATCH').length > before, 'Rejection is submitted')
  check('rejection-uses-reject-endpoint', calls.some(call => call.path === '/api/orders/r1/reject' && call.method === 'PATCH'))

  // An approved order must not offer rejection at all.
  await render(<OrderStatusDialog order={order('r2', 'APPROVED', 'PENDING', company.id)} disabled={false} />)
  await until(() => !!document.querySelector('[aria-label="Mark as paid ORD-r2"]'), 'Approved order offers its forward step')
  check('no-reject-for-an-approved-order', !document.querySelector('[aria-label="Reject ORD-r2"]'))
  check('approved-order-offers-only-its-next-step', button('Reject') === null)

  // A rejected order is terminal.
  await render(<OrderStatusDialog order={order('r3', 'REJECTED', 'PENDING', company.id)} disabled={false} />)
  await flush()
  check('rejected-order-offers-nothing', button('Reject') === null && button('Approve') === null)

  // ---- 7. Role gating: a non-reviewer gets no bell and issues no queue requests.
  await identity('STAFF')
  const staffStart = calls.length
  await render(<Header />)
  await flush()
  check('staff-sees-no-bell', bell() === null)
  const staffCalls = calls.slice(staffStart).map(call => call.path)
  check('staff-issues-no-review-requests',
    !staffCalls.some(p => p.startsWith('/api/network?') || p.startsWith('/api/agreements?') || p.startsWith('/api/orders?') || p.startsWith('/api/members/requests')))

  // A Distributor reviewer does get a bell now (it can receive agreements/connections).
  state = { pendingMembers: 0, pendingConnections: 1, pendingAgreements: 0, ordersUnderReview: 0, orderDecisions: true }
  await identity('OWNER', 'DISTRIBUTOR')
  await render(<Header />)
  await until(() => !!bell(), 'Distributor reviewer gets a bell')
  check('distributor-reviewer-sees-bell', !!bell())
  await openBell()
  check('distributor-sees-connection-requests', notice('Connection requests')?.count === '1')
} finally {
  fs.writeFileSync(path.join(process.cwd(), 'audits/notifications-and-order-reject-ui.json'), JSON.stringify({ simulatedDOM: true, liveDataUsed: false, evidence }, null, 2))
  await React.act(async () => root.unmount())
  qc.clear(); ScrollTrigger.disable(); gsap.ticker.sleep(); dom.window.close()
}
process.exit(0)
