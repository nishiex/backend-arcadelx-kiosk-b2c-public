// Real component + mocked HTTP; never sends email or writes to the live database.
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const requireTest = createRequire(path.join(os.tmpdir(), 'arcadelx-ui-tests/package.json'))
const { JSDOM } = requireTest('jsdom')
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
const w = dom.window
for (const key of ['window', 'self', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'Event', 'CustomEvent', 'FocusEvent', 'MouseEvent', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'getComputedStyle' ? w.getComputedStyle.bind(w) : w[key] })
}
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')
const { default: AddPartnerForm } = await import('../components/partners/AddPartnerForm')
let type = 'DISTRIBUTOR', role = 'OWNER', status = 'ACTIVE'
const me = () => ({ id: 'owner', name: 'Owner', email: 'owner@example.invalid', membership: { organizationId: 'distributor', role, status, organization: { id: 'distributor', type, name: 'Distributor' } } })
const calls: { route: string; body: Record<string, unknown>; credentials?: RequestCredentials }[] = []
let fail = false, hold = false, release: (() => void) | undefined
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data, success: status < 400, message: status >= 400 ? 'Registration unavailable' : 'Success' }), { status, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (input, init) => {
  const route = new URL(String(input), 'http://localhost').pathname
  if (route === '/api/auth/me') return response({ user: me() })
  calls.push({ route, body: JSON.parse(String(init?.body || '{}')), credentials: init?.credentials })
  if (route === '/api/auth/register') {
    if (hold) await new Promise<void>(resolve => { release = resolve })
    if (fail) return response(null, 503)
    return response({ organization: { id: 'partner', name: 'Test Partner', type: 'PARTNER' }, owner: { id: 'new-owner', name: 'Partner Owner', email: 'partner@example.invalid' }, credentialsEmailSent: false }, 201)
  }
  if (route === '/api/auth/organizations/partner/credentials/retry') return response({ credentialsEmailSent: true })
  throw new Error(`Unexpected request ${route}`)
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const root = createRoot(document.getElementById('root')!)
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text)
const posts = () => calls.filter(call => call.route === '/api/auth/register')
async function until(test: () => boolean) {
  const end = Date.now() + 4000
  while (!test() && Date.now() < end) await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  assert.ok(test())
}
async function identity() {
  await React.act(async () => { qc.setQueryData(['me'], me()); await new Promise(resolve => setTimeout(resolve, 20)) })
}
async function setValue(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement
  assert.ok(input)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}
async function submit() {
  await React.act(async () => { document.querySelector('form')!.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })) })
}
try {
  await React.act(async () => root.render(<QueryClientProvider client={qc}><AddPartnerForm modal /></QueryClientProvider>))
  await until(() => !!button('Register Partner'))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  for (const [org, memberRole, memberStatus] of [
    ['COMPANY', 'OWNER', 'ACTIVE'], ['PARTNER', 'OWNER', 'ACTIVE'],
    ['DISTRIBUTOR', 'MANAGER', 'ACTIVE'], ['DISTRIBUTOR', 'STAFF', 'ACTIVE'],
    ['DISTRIBUTOR', 'OWNER', 'PENDING'], ['DISTRIBUTOR', 'ADMIN', 'REJECTED'],
  ]) {
    type = org!; role = memberRole!; status = memberStatus!; await identity()
    assert.equal(document.querySelector('form'), null)
    assert.equal(button('Register Partner'), undefined)
  }
  type = 'DISTRIBUTOR'; role = 'ADMIN'; status = 'ACTIVE'; await identity()
  assert.ok(button('Register Partner'))
  console.log('PASS active Distributor OWNER/ADMIN only; other organizations, roles and inactive memberships denied')
  await React.act(async () => button('Register Partner')!.click())
  await until(() => !!document.querySelector('[role="dialog"] form'))
  assert.equal(w.location.pathname, '/', 'modal opens without navigating away from dashboard')
  await submit()
  assert.equal(posts().length, 0)
  for (const [id, value] of Object.entries({ orgName: 'Test Partner', ownerName: 'Partner Owner', ownerEmail: 'partner@example.invalid', address: 'Test street address', city: 'Mumbai', state: 'Maharashtra', pincode: '000000' })) await setValue(id, value)
  await submit()
  assert.equal(posts().length, 0)
  await setValue('pincode', '400001')
  await submit()
  assert.equal(posts().length, 0, 'Owner contact is required')
  for (const invalid of ['123', 'abcdefghij', '12345678901']) {
    await setValue('ownerContact', invalid); await submit()
    assert.equal(posts().length, 0, 'Owner contact must contain exactly ten digits')
  }
  await setValue('ownerContact', '0123456789')
  await setValue('gstNumber', 'TEST-PARTNER-GST')
  fail = true; await submit()
  await until(() => !!document.querySelector('[role="alert"]'))
  assert.ok(document.querySelector('form'))
  fail = false; hold = true
  await submit()
  await until(() => !!release)
  const count = posts().length
  await submit()
  assert.equal(posts().length, count)
  await React.act(async () => { document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  assert.ok(document.querySelector('[role="dialog"]'), 'pending registration cannot be dismissed')
  assert.ok((document.querySelector('[aria-label="Close partner registration"]') as HTMLButtonElement).disabled)
  await React.act(async () => release!())
  await until(() => !!button('Retry credentials email'))
  assert.equal(document.querySelector('form'), null)
  assert.deepEqual(posts().at(-1)!.body, { orgName: 'Test Partner', ownerName: 'Partner Owner', ownerEmail: 'partner@example.invalid', ownerContact: '0123456789', gstNumber: 'TEST-PARTNER-GST', address: 'Test street address', state: 'Maharashtra', city: 'Mumbai', pincode: 400001, orgType: 'PARTNER' })
  assert.equal(posts().at(-1)!.credentials, 'include')
  assert.ok(document.body.textContent?.includes('have not been emailed'))
  await React.act(async () => button('Retry credentials email')!.click())
  await until(() => !!document.body.textContent?.includes('Login credentials emailed'))
  assert.equal(posts().length, count)
  assert.equal(calls.at(-1)?.route, '/api/auth/organizations/partner/credentials/retry')
  console.log('PASS validation, failure recovery, duplicate prevention, existing API payload, cookies and credentials retry')
  await React.act(async () => (document.querySelector('[aria-label="Close partner registration"]') as HTMLButtonElement).click())
  await until(() => !document.querySelector('[role="dialog"]'))
  await React.act(async () => button('Register Partner')!.click())
  await until(() => !!document.querySelector('form'))
  assert.equal((document.getElementById('orgName') as HTMLInputElement).value, '')
  assert.equal(document.querySelector('[role="status"]'), null)
  await React.act(async () => { document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  await until(() => !document.querySelector('[role="dialog"]'))
  console.log('PASS dashboard modal opens, protects pending submission, closes and resets on reopening')
} finally {
  await React.act(async () => root.unmount())
  qc.clear(); dom.window.close()
}
process.exit(0)
