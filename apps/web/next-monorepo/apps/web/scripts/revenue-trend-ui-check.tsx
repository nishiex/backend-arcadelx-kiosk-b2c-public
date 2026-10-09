// Real components + mocked HTTP in an in-memory DOM; no live API or database writes.
// Run from the repo root with the auth-registration runtime loader:
//   node -r ./audits/auth-registration/runtime-loader.cjs apps/web/next-monorepo/apps/web/scripts/revenue-trend-ui-check.tsx
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
// jsdom has no ResizeObserver; recharts' ResponsiveContainer only needs it to exist.
// Rendered chart geometry is deliberately not asserted here (jsdom reports 0x0),
// so the checks target the surrounding DOM contract instead.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
;(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub
;(w as unknown as Record<string, unknown>).ResizeObserver = ResizeObserverStub
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { AppRouterContext } = await import('next/dist/shared/lib/app-router-context.shared-runtime.js')
const { PathnameContext } = await import('next/dist/shared/lib/hooks-client-context.shared-runtime.js')
const { default: RevenueTrendChart } = await import('../components/dashboard/RevenueTrendChart')
const { default: DashboardScreen } = await import('../components/dashboard/DashboardScreen')
const { gsap, ScrollTrigger } = await import('../lib/gsap')

const company = { id: 'company-1', name: 'ArcadeLX', type: 'COMPANY' }
let role = 'OWNER'
const me = () => ({ id: 'user-1', name: 'Owner', email: 'owner@example.invalid', permissions: [], membership: { status: 'ACTIVE', role, organizationId: company.id, organization: company } })

/** Point counts mirror the API's own range buckets. */
const BUCKETS: Record<string, { granularity: string; bucket: string; count: number }> = {
  '7d': { granularity: 'Daily', bucket: 'day', count: 7 },
  '30d': { granularity: 'Daily', bucket: 'day', count: 30 },
  '3m': { granularity: 'Weekly', bucket: 'week', count: 14 },
  '1y': { granularity: 'Monthly', bucket: 'month', count: 13 },
}

let seriesRevenue = 0
let seriesFails = false
let holdSeries = false
let releaseSeries: (() => void) | undefined
const calls: { path: string; method: string }[] = []
const evidence: { check: string; pass: boolean }[] = []

function seriesBody(range: string) {
  const config = BUCKETS[range]!
  const perPoint = seriesRevenue ? seriesRevenue / config.count : 0
  const points = Array.from({ length: config.count }, (_, index) => ({
    key: `2026-09-${String(index + 1).padStart(2, '0')}`,
    label: `${index + 1} Sep`,
    revenue: perPoint,
  }))
  return {
    range, granularity: config.granularity, bucket: config.bucket, currency: 'INR',
    total: seriesRevenue, points,
  }
}

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  calls.push({ path: url.pathname + url.search, method })
  let data: unknown
  if (url.pathname === '/api/auth/me') data = { user: me() }
  else if (url.pathname === '/api/revenue/series') {
    if (holdSeries) await new Promise<void>(resolve => { releaseSeries = resolve })
    if (seriesFails) return new Response(JSON.stringify({ success: false, message: 'Revenue trend unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    data = seriesBody(url.searchParams.get('range') ?? '30d')
  }
  // Remaining dashboard panels, kept intentionally minimal.
  else if (url.pathname === '/api/kiosks/summary') data = { summary: {} }
  else if (url.pathname === '/api/kiosks') data = { kiosks: [] }
  else if (url.pathname === '/api/members/requests') data = { data: [], meta: { total: 0, page: 1, limit: 1, totalPages: 1 } }
  else if (url.pathname === '/api/network/requests') data = { data: [], meta: { total: 0, page: 1, limit: 1, totalPages: 1 } }
  else throw new Error(`Unexpected mocked request: ${url.pathname}`)
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
// Captured so a failing check reports React's own complaint, not just the assertion.
const reactErrors: string[] = []
const realConsoleError = console.error
console.error = (...args: unknown[]) => { reactErrors.push(String(args[0]).slice(0, 300)); realConsoleError(...args) }
const diagnose = () => {
  realConsoleError('BODY:', JSON.stringify((document.body.textContent ?? '').slice(0, 700)))
  realConsoleError('REACT_ERRORS:', JSON.stringify(reactErrors.slice(-4)))
  realConsoleError('SERIES_CALLS:', JSON.stringify(seriesCalls().map(call => call.path)))
}
const router = { bfcacheId: 'test', back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch: async () => {} }
const check = (name: string, pass: boolean) => { evidence.push({ check: name, pass }); assert.ok(pass, name); console.log(name, 'PASS') }
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function until(test: () => boolean, description: string, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!test() && Date.now() < deadline) await flush()
  if (!test()) diagnose()
  assert.ok(test(), description)
}
async function render(component: React.ReactNode, client = qc) {
  await React.act(async () => {
    root.render(<QueryClientProvider client={client}><AppRouterContext.Provider value={router}><PathnameContext.Provider value="/">{component}</PathnameContext.Provider></AppRouterContext.Provider></QueryClientProvider>)
  })
  await flush()
}
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text) ?? null
async function click(element: Element | null) { assert.ok(element, 'Target element exists'); await React.act(async () => (element as HTMLElement).click()); await flush() }
const seriesCalls = () => calls.filter(call => call.path.startsWith('/api/revenue/series'))
const panelText = () => document.body.textContent ?? ''

try {
  await React.act(async () => { qc.setQueryData(['me'], me()) })

  // 1. Loading state while the series is in flight.
  holdSeries = true
  await render(<RevenueTrendChart />)
  await until(() => !!document.querySelector('.animate-pulse'), 'Loading skeleton renders')
  check('loading-state-uses-skeleton', !!document.querySelector('.animate-pulse') && !panelText().includes("Couldn't load"))
  releaseSeries?.()
  holdSeries = false
  await flush()

  // 2. Empty state: the API returns every bucket, all zero (the real local case).
  seriesRevenue = 0
  await React.act(async () => { await qc.invalidateQueries({ queryKey: ['revenue-series'] }) })
  await until(() => panelText().includes('No revenue recorded'), 'Empty state renders when every bucket is zero')
  check('empty-state-explains-no-revenue', panelText().includes('No revenue recorded in last 30 days'))
  check('empty-state-shows-zero-total', panelText().includes('₹0'))

  // 3. Non-empty state: range total and accessibility label.
  seriesRevenue = 1234560
  await React.act(async () => { await qc.invalidateQueries({ queryKey: ['revenue-series'] }) })
  await until(() => !panelText().includes('No revenue recorded') && panelText().includes('12,34,560'), 'Range total renders')
  check('total-uses-indian-currency-format', panelText().includes('₹12,34,560'))
  check('subtitle-names-window-and-granularity', panelText().includes('Gross revenue') && panelText().includes('Last 30 days') && panelText().includes('Daily'))
  const chartRegion = document.querySelector('[role="img"]')
  check('chart-exposes-accessible-summary', !!chartRegion && (chartRegion.getAttribute('aria-label') ?? '').includes('12,34,560'))

  // 4. Range filter issues the matching request and relabels the window.
  await click(button('7D'))
  await until(() => !!seriesCalls().find(call => call.path.includes('range=7d')), '7D range requests the 7d series')
  check('range-filter-requests-selected-window', seriesCalls().some(call => call.path === '/api/revenue/series?range=7d'))
  await until(() => panelText().includes('Last 7 days'), 'Subtitle follows the selected range')
  await click(button('1Y'))
  await until(() => !!seriesCalls().find(call => call.path.includes('range=1y')), '1Y range requests the 1y series')
  await until(() => panelText().includes('Monthly'), 'Granularity follows the selected range')
  check('range-buttons-expose-pressed-state', (button('1Y') as HTMLButtonElement).getAttribute('aria-pressed') === 'true' && (button('7D') as HTMLButtonElement).getAttribute('aria-pressed') === 'false')

  // 5. Error state, then recovery through retry.
  seriesFails = true
  await click(button('3M'))
  await until(() => panelText().includes("Couldn't load the revenue trend"), 'Error state renders')
  check('error-state-offers-retry', button('Try again') !== null)
  seriesFails = false
  await click(button('Try again'))
  await until(() => !panelText().includes("Couldn't load the revenue trend") && panelText().includes('Last 3 months'), 'Retry recovers the chart')
  check('retry-recovers-after-failure', panelText().includes('Weekly'))

  // 6. Role gating: the chart is mounted by the dashboard only for revenue roles,
  //    so an unauthorized role must not even issue the request.
  //    One QueryClient is reused throughout: QueryClientProvider does not swap
  //    clients on a prop change, so identity is changed through the shared cache.
  const callsBefore = seriesCalls().length
  role = 'STAFF'
  await React.act(async () => { qc.setQueryData(['me'], me()) })
  await render(<DashboardScreen />)
  await until(() => !!document.querySelector('h2'), 'Staff dashboard loads')
  check('staff-sees-no-revenue-chart', !panelText().includes('Revenue trend'))
  check('staff-issues-no-revenue-series-request', seriesCalls().length === callsBefore)

  role = 'OWNER'
  await React.act(async () => {
    // Drop the cached series so a fresh request proves the chart mounted.
    qc.removeQueries({ queryKey: ['revenue-series'] })
    qc.setQueryData(['me'], me())
  })
  await render(<DashboardScreen />)
  await until(() => panelText().includes('Revenue trend'), 'Revenue role gets the chart on the dashboard')
  check('revenue-role-sees-chart-on-dashboard', panelText().includes('Revenue trend'))
  await until(() => seriesCalls().length > callsBefore, 'Dashboard chart requests the series')
  check('dashboard-chart-requests-the-series', seriesCalls().length > callsBefore)

  // 7. The real API contract must stay compatible with this component.
  const backendApi = fs.readFileSync(path.join(process.cwd(), 'apps/web/next-monorepo/apps/web/lib/backend-api.ts'), 'utf8')
  const controller = fs.readFileSync(path.join(process.cwd(), 'apps/api/src/controllers/Revenue/revenue.controller.ts'), 'utf8')
  const routes = fs.readFileSync(path.join(process.cwd(), 'apps/api/src/routes/Revenue/revenue.routes.ts'), 'utf8')
  check('endpoint-and-route-exist', routes.includes('/series') && controller.includes('getRevenueSeries'))
  check('component-uses-the-real-helper', backendApi.includes('fetchRevenueSeries') && !backendApi.includes('mock-data'))
} finally {
  fs.writeFileSync(path.join(process.cwd(), 'audits/revenue-trend-ui.json'), JSON.stringify({ simulatedDOM: true, liveDataUsed: false, chartGeometryAsserted: false, evidence }, null, 2))
  await React.act(async () => root.unmount())
  qc.clear(); ScrollTrigger.disable(); gsap.ticker.sleep(); dom.window.close()
}
process.exit(0)
