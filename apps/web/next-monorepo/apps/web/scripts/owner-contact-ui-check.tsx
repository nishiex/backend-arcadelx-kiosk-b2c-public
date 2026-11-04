// Real Distributor registration form; mocked HTTP/router, no live writes.
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
const { default: AddDistributorForm } = await import('../components/distributors/AddDistributorForm')


const { gsap, ScrollTrigger } = await import('../lib/gsap')
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
const redirects: string[] = []
const router = { bfcacheId: 'test', back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push(url: string) { redirects.push(url) }, replace() {}, prefetch: async () => {} }
const calls: { route: string; body: Record<string, unknown> }[] = []
let fail = true
const me = { id: 'owner', name: 'Owner', membership: { organizationId: 'company', status: 'ACTIVE', role: 'OWNER', organization: { id: 'company', name: 'Company', type: 'COMPANY' } } }
globalThis.fetch = async (input, init) => {
  const route = new URL(String(input), 'http://localhost').pathname
  assert.equal(init?.credentials, 'include')
  if (route === '/api/auth/me') return Response.json({ data: { user: me } })
  const body = JSON.parse(String(init?.body ?? '{}'))
  calls.push({ route, body })
  if (route === '/api/members/generateInviteCode') return Response.json({ data: { inviteCode: 'TESTCODE12' } })
  if (route === '/api/auth/register') {
    if (fail) return Response.json({ message: 'User with this contact number already exists' }, { status: 409 })
    return Response.json({ data: { organization: { id: 'dist', name: body.orgName, type: 'DISTRIBUTOR' }, owner: { id: 'dist-owner', name: body.ownerName, email: body.ownerEmail, contact: body.ownerContact }, credentialsEmailSent: true } }, { status: 201 })
  }
  throw new Error('Unexpected request ' + route)
}
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
async function fill(name: string, value: string) {
  await React.act(async () => {
    const element = document.querySelector(`[name="${name}"]`)!
    const select = element.tagName === 'SELECT'
    Object.getOwnPropertyDescriptor(select ? w.HTMLSelectElement.prototype : w.HTMLInputElement.prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new w.Event(select ? 'change' : 'input', { bubbles: true }))
  })
  await flush()
}
async function submit() { await React.act(async () => { document.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) }); await flush() }
try {
  qc.setQueryData(['me'], me)
  await React.act(async () => root.render(<QueryClientProvider client={qc}><AppRouterContext.Provider value={router}><PathnameContext.Provider value="/distributors/new"><AddDistributorForm /></PathnameContext.Provider></AppRouterContext.Provider></QueryClientProvider>))
  await flush()
  for (const [name, value] of Object.entries({ orgName: 'Contact Distributor', ownerName: 'Owner Person', ownerEmail: 'owner@example.invalid', address: 'Test street address', state: 'Maharashtra', city: 'Mumbai', pincode: '400001', phone: '9999999999', gstNumber: '123456789012' })) await fill(name, value)
  for (const value of ['', '12345', 'abcdefghij', '12345678901']) {
    await fill('ownerContact', value); await submit()
    assert.equal(calls.length, 0, 'Invalid contact makes no invite or registration calls')
  }
  assert.equal(document.querySelector('[name="ownerContact"]')?.getAttribute('type'), 'tel')
  await fill('ownerContact', '0123456789'); await submit()
  assert.equal(calls.at(-1)?.route, '/api/auth/register')
  assert.equal(redirects.length, 0, 'Duplicate error preserves form for correction')
  assert.ok(document.querySelector('form'))
  await fill('ownerContact', '0987654321'); fail = false; await submit()
  assert.equal(redirects.at(-1), '/distributors')
  assert.equal(calls.at(-1)?.body.ownerContact, '0987654321')
  assert.equal(calls.at(-1)?.body.phone, '9999999999')
  assert.equal(calls.at(-1)?.body.gstNumber, '123456789012')
  assert.equal(calls.at(-1)?.body.inviteCode, 'TESTCODE12')
  assert.ok(!document.querySelector('[name="inviteCode"]'), 'Invite stays system-generated')
  console.log('PASS Distributor contact validation, separate organization phone/GST, duplicate recovery, automatic invite and successful registration redirect')
} finally {
  await React.act(async () => root.unmount())
  qc.clear(); ScrollTrigger.disable(); gsap.ticker.sleep(); dom.window.close()
}
process.exit(0)
