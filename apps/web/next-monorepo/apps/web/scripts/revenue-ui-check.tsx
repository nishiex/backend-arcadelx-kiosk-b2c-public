// Real RevenueScreen and Sidebar; mocked HTTP/router, no live writes.
import assert from 'node:assert/strict'
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
const { default: RevenueScreen } = await import('../components/revenue/RevenueScreen')

const { default: Sidebar } = await import('../components/dashboard/Sidebar')
const { gsap, ScrollTrigger } = await import('../lib/gsap')
let role = 'OWNER', type = 'COMPANY', status = 'ACTIVE', orgId = 'company'
const me = () => ({ id: 'test-user', name: 'Test', membership: { status, role, organizationId: orgId, organization: { id: orgId, type, name: 'Test Org' } } })
const rows = [{ machineCode: 'K-001', location: 'Pune', distributor: 'Distributor A', partner: 'Partner B', deployedPartner: 'Partner B', today: 12.34, thisMonth: 200, totalRevenue: 300 }]
let settings = { gstPercentage: '18', pgFeePercentage: '2.50', tdsPercentage: '2' }
const paymentRows = [{
  txnid: 'txn-001',
  device_id: 'device-001',
  game_id: 'game-001',
  amount: 180,
  currency: 'INR',
  status: 'pending',
  provider: 'test-provider',
  qr_id: null,
  created_at: '2026-10-07T10:00:00.000Z',
  updated_at: '2026-10-07T10:00:00.000Z',
}]
const calls: { route: string; method: string; body: unknown }[] = []
let failPatch = false, failRevenue = false, empty = false
let release: (() => void) | undefined
let gate: Promise<void> | undefined
globalThis.fetch = async (input, init) => {
  const route = new URL(String(input), 'http://localhost').pathname
  const method = init?.method ?? 'GET'
  assert.equal(init?.credentials, 'include')
  calls.push({ route, method, body: JSON.parse(String(init?.body ?? '{}')) })
  if (route === '/api/auth/me') return Response.json({ data: { user: me() } })
  if (route === '/api/revenue/machine-wise') {
    if (gate) await gate
    return failRevenue ? Response.json({ message: 'Revenue temporarily unavailable' }, { status: 503 }) : Response.json({ data: { kiosks: empty ? [] : rows } })
  }
  if (route === '/api/revenue/series') return Response.json({ data: { range: '30d', granularity: 'Daily', bucket: 'day', currency: 'INR', total: 30, points: [{ key: '2026-10-01', label: '1 Oct', revenue: 30 }] } })
  if (route === '/api/revenue/payments') {
    assert.equal(method, 'GET')
    return Response.json({
      data: { total: paymentRows.length, payments: paymentRows, fetchedAt: '2026-10-07T10:01:00.000Z', page: 1, pageSize: 50, totalPages: 1 },
    })
  }
  if (route === '/api/revenue/payments/sync') {
    assert.equal(method, 'POST')
    return Response.json({ data: { devices: { newKiosksCreated: 1 }, transactions: { totalRecordsFetched: 2, newRecordsInserted: 1, unattributedCount: 0 } } })
  }
  if (route === '/api/revenue/deduction-rates') {
    if (method === 'PATCH') {
      if (gate) await gate
      if (failPatch) return Response.json({ message: 'Unable to save rates' }, { status: 503 })
      settings = JSON.parse(String(init?.body))
    }
    return Response.json({ data: { settings } })
  }
  throw new Error('Unexpected request: ' + route)
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
const router = { bfcacheId: 'test', back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch: async () => {} }
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function render(show = true) {
  await React.act(async () => root.render(<QueryClientProvider client={qc}><AppRouterContext.Provider value={router}><PathnameContext.Provider value="/revenue"><Sidebar />{show && <RevenueScreen />}</PathnameContext.Provider></AppRouterContext.Provider></QueryClientProvider>))
  await flush()
}
async function identity() { await React.act(async () => { qc.setQueryData(['me'], me()) }); await flush() }
const button = (label: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === label)!
const text = () => document.body.textContent ?? ''
const count = (route: string, method = 'GET') => calls.filter(call => call.route === '/api/revenue/' + route && call.method === method).length
async function click(element: HTMLElement) { assert.ok(element); await React.act(async () => element.click()); await flush() }
async function fill(id: string, value: string) {
  await React.act(async () => {
    const input = document.getElementById(id)!
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}
async function submit() { await React.act(async () => { document.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) }); await flush() }
try {
  await identity()
  gate = new Promise(resolve => { release = resolve })
  await render()
  assert.ok(!text().includes('Machine revenue'), 'Loading does not show fake ledger data')
  await React.act(async () => release!()); gate = undefined; await flush()
  assert.ok(text().includes('₹12.34')); assert.ok(text().includes('₹200.00')); assert.ok(text().includes('K-001'))
  assert.equal(document.querySelector('a[href="/revenue"]')?.getAttribute('aria-current'), 'page')
  assert.equal(count('machine-wise'), 1); assert.equal(count('deduction-rates'), 1)
  await render(false); await render(true)
  assert.equal(count('machine-wise'), 1, 'Navigating back reuses fresh revenue cache')
  assert.equal(count('deduction-rates'), 1)
  assert.ok(button('Sync latest payments'), 'Company owner can sync the payment feed')
  assert.ok(text().includes('Read-only feed'))
  assert.equal(count('payments'), 1, 'Opening Revenue fetches payment feed without syncing')
  assert.equal(count('sync', 'POST'), 0, 'Reading the feed does not import payments')
  await click(button('Sync latest payments'))
  assert.equal(count('sync', 'POST'), 1, 'Button imports the payment feed')
  assert.ok(count('payments') >= 2, 'Sync refreshes the visible payment feed')
  assert.ok(text().includes('txn-001'))
  assert.ok(text().includes('pending'))
  assert.equal(count('machine-wise'), 2, 'Sync refreshes ledger totals')
  await fill('revenue-search', 'missing'); assert.ok(text().includes('No machines match'))
  await fill('revenue-search', 'partner b'); assert.ok(document.querySelector('tbody')?.textContent?.includes('K-001'))
  await fill('revenue-search', '')
  console.log('PASS loading, real totals, machine search, read-only payment fetch, explicit sync, active navigation and cached remount')

  await click(button('Edit rates'))
  assert.equal((document.getElementById('pgFeePercentage') as HTMLInputElement).value, '2.5')
  await fill('gstPercentage', '99'); await fill('pgFeePercentage', '2'); await submit()
  assert.ok(text().includes('cannot exceed 100')); assert.equal(count('deduction-rates', 'PATCH'), 0)
  await fill('gstPercentage', '18.111'); await submit(); assert.equal(count('deduction-rates', 'PATCH'), 0)
  await fill('gstPercentage', '18'); await fill('pgFeePercentage', '3')
  failPatch = true; await submit(); assert.ok(text().includes('Unable to save rates'))
  failPatch = false; gate = new Promise(resolve => { release = resolve }); await submit()
  assert.ok(button('Saving…').disabled)
  await submit(); assert.equal(count('deduction-rates', 'PATCH'), 2, 'Double submit is blocked')
  await React.act(async () => release!()); gate = undefined; await flush()
  assert.ok(!document.querySelector('form')); assert.ok(text().includes('3%'))
  assert.deepEqual(calls.filter(call => call.method === 'PATCH').at(-1)?.body, { gstPercentage: 18, pgFeePercentage: 3, tdsPercentage: 2 })
  console.log('PASS rate normalization, validation, errors, duplicate submit protection and saved cache')

  for (const org of ['COMPANY', 'DISTRIBUTOR', 'PARTNER']) {
    type = org; orgId = org.toLowerCase()
    for (const memberRole of ['OWNER', 'ADMIN', 'MANAGER', 'STAFF']) {
      role = memberRole; await identity()
      assert.equal(!!document.querySelector('a[href="/revenue"]'), role !== 'STAFF', `${type} ${role} revenue navigation`)
      assert.equal(!!document.querySelector('table'), role !== 'STAFF', `${type} ${role} revenue table`)
      assert.equal(!!button('Edit rates'), type === 'COMPANY' && ['OWNER', 'ADMIN'].includes(role), `${type} ${role} edit-rate access`)
      assert.equal(!!button('Sync latest payments'), type === 'COMPANY' && ['OWNER', 'ADMIN'].includes(role), `${type} ${role} payment-sync access`)
    }
  }
  const requestsBefore = calls.length
  orgId = 'pending'; role = 'OWNER'; status = 'PENDING'; await identity()
  assert.ok(!document.querySelector('a[href="/revenue"]')); assert.ok(!document.querySelector('table'))
  assert.equal(calls.length, requestsBefore, 'Inactive membership makes no revenue calls')
  type = 'COMPANY'; role = 'OWNER'; status = 'ACTIVE'; orgId = 'other-company'; await identity()
  assert.ok(qc.getQueryData(['revenue-machines', 'test-user', 'other-company', 'OWNER']), 'Organization-scoped cache')
  await click(button('Edit rates')); role = 'STAFF'; await identity()
  assert.ok(!document.querySelector('form'), 'Permission loss immediately removes editor and data')
  console.log('PASS all organization/role gates, inactive access, scoped cache and permission changes')

  role = 'OWNER'; await identity(); await render(false); await render(true)
  failRevenue = true; await click(button('Refresh')); await flush()
  assert.ok(text().includes('Revenue temporarily unavailable')); assert.ok(!text().includes('K-001'))
  failRevenue = false; empty = true; await click(button('Try again'))
  assert.ok(text().includes('No machine revenue to show yet.'))
  console.log('PASS failed refresh, retry and empty state')
} finally {
  release?.()
  await React.act(async () => root.unmount())
  qc.clear(); ScrollTrigger.disable(); gsap.ticker.sleep(); dom.window.close()
}
process.exit(0)
