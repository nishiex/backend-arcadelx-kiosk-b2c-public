// Real Settings, JoinForm and Sidebar components; mocked HTTP/router, no live writes.
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
const { default: Settings } = await import('../components/settings/SettingsScreen')
const { default: JoinForm } = await import('../components/auth/JoinForm')
const { default: Sidebar } = await import('../components/dashboard/Sidebar')
const { gsap, ScrollTrigger } = await import('../lib/gsap')
let role = 'OWNER', type = 'COMPANY', status = 'ACTIVE'
const me = () => ({ id: 'test-user', name: 'Test User', email: 'test@example.invalid', membership: { status, role, organizationId: 'company', organization: { id: 'company', type, name: 'Company' } } })
const calls: { route: string; body: Record<string, string> }[] = []
const redirects: string[] = []
const router = { bfcacheId: 'test', back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace(url: string) { redirects.push(url) }, prefetch: async () => {} }
let joinStatus = 'ACTIVE'
globalThis.fetch = async (input, init) => {
  const route = new URL(String(input), 'http://localhost').pathname
  if (route === '/api/auth/me') return Response.json({ data: { user: me() } })
  const body = JSON.parse(String(init?.body || '{}'))
  calls.push({ route, body })
  if (route === '/api/members/generateInviteCode') return Response.json({ data: { inviteCode: 'S.AbCdEf12', role: body.role, expiresAt: '2026-10-12T00:00:00Z' } })
  if (route === '/api/auth/join') return Response.json({ data: { membership: { status: joinStatus, role: joinStatus === 'ACTIVE' ? 'STAFF' : null } } }, { status: 201 })
  throw new Error('Unexpected API request: ' + route)
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function render(component: React.ReactNode) {
  await React.act(async () => { root.render(<QueryClientProvider client={qc}><AppRouterContext.Provider value={router}><PathnameContext.Provider value="/">{component}</PathnameContext.Provider></AppRouterContext.Provider></QueryClientProvider>) })
  await flush()
}
async function identity() { await React.act(async () => { qc.setQueryData(['me'], me()) }); await flush() }
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text)!
async function click(element: HTMLElement) { assert.ok(element); await React.act(async () => element.click()); await flush() }
async function fill(id: string, value: string) {
  await React.act(async () => {
    const input = document.getElementById(id)!
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}
try {
  await identity(); await render(<Settings />)
  await click(button('Generate Invite Code'))
  assert.deepEqual([...document.querySelectorAll('#member-invite-role option')].map(el => el.textContent), ['ADMIN', 'MANAGER', 'STAFF'])
  await React.act(async () => {
    const select = document.getElementById('member-invite-role') as HTMLSelectElement
    select.value = 'MANAGER'; select.dispatchEvent(new w.Event('change', { bubbles: true }))
  })
  await click(button('Generate code'))
  assert.deepEqual(calls.at(-1), { route: '/api/members/generateInviteCode', body: { role: 'MANAGER' } })
  assert.ok(document.querySelector('a[href="/join"]'))
  assert.ok(!document.querySelector('[role="dialog"] a[href="/distributors/new"]'))
  await click(document.querySelector('[aria-label="Close invite code"]')!)
  role = 'ADMIN'; await identity(); await click(button('Generate Invite Code'))
  assert.deepEqual([...document.querySelectorAll('#member-invite-role option')].map(el => el.textContent), ['MANAGER', 'STAFF'])
  await click(document.querySelector('[aria-label="Close invite code"]')!)
  for (const [org, memberRole] of [['COMPANY', 'MANAGER'], ['COMPANY', 'STAFF'], ['DISTRIBUTOR', 'OWNER'], ['PARTNER', 'OWNER']]) {
    type = org!; role = memberRole!; await identity()
    assert.equal(button('Generate Invite Code'), undefined)
  }
  console.log('PASS Settings role options, Company authorization, generation payload and internal registration link')
  for (const result of ['ACTIVE', 'PENDING']) {
    joinStatus = result
    qc.setQueryData(['orders', 'old-user'], ['private old data'])
    await render(<JoinForm key={result} />)
    await React.act(async () => { document.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) })
    assert.equal(calls.filter(c => c.route === '/api/auth/join').length, result === 'ACTIVE' ? 0 : 1, 'Invite required')
    for (const [id, value] of Object.entries({ name: 'Invited colleague', email: 'colleague@example.invalid', password: 'DemoPassword123!', inviteCode: 'S.AbCdEf12' })) await fill(id, value)
    await React.act(async () => { document.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    assert.equal(calls.at(-1)!.body.inviteCode, 'S.AbCdEf12', 'Code case is preserved')
    assert.equal(calls.at(-1)!.body.role, undefined, 'Role is not self-assigned')
    assert.equal(qc.getQueryData(['orders', 'old-user']), undefined, 'Previous session cache cleared')
    assert.equal(redirects.at(-1), '/')
  }
  console.log('PASS registration validation, exact invite, session cache clearing and dashboard redirect')
  type = 'COMPANY'; status = 'ACTIVE'
  for (const memberRole of ['ADMIN', 'MANAGER', 'STAFF']) {
    role = memberRole; await identity(); await render(<Sidebar />)
    assert.ok(document.querySelector('a[href="/"]'))
    assert.ok(document.querySelector('a[href="/kiosks"]'))
    assert.equal(!!document.querySelector('a[href="/user"]'), role === 'ADMIN')
  }
  console.log('PASS Company dashboard navigation respects ADMIN / MANAGER / STAFF roles')
} finally {
  await React.act(async () => root.unmount())
  qc.clear(); ScrollTrigger.disable(); gsap.ticker.sleep(); dom.window.close()
}
process.exit(0)
