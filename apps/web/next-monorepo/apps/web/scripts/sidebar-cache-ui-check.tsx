// Real sidebar/query hooks with simulated route context and mocked HTTP.
// Run with node -r ./audits/auth-registration/runtime-loader.cjs <this file>.
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const requireTest = createRequire(path.join(os.tmpdir(), "arcadelx-ui-tests/package.json"))
const { JSDOM } = requireTest("jsdom")
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true })
for (const key of ["window", "self", "document", "navigator", "HTMLElement", "Element", "Node", "MutationObserver", "Event", "MouseEvent"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
}
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const React = await import("react")
const { createRoot } = await import("react-dom/client")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js")
const { default: Sidebar } = await import("../components/dashboard/Sidebar")
const { useMe } = await import("../hooks/useMe")
let role = "OWNER", type = "COMPANY"
const identity = () => ({ id: "test-owner", name: "Test Owner", permissions: [], membership: { organizationId: "test-org", role, status: "ACTIVE", organization: { id: "test-org", type, name: "Test Company" } } })
let calls = 0
globalThis.fetch = async input => {
  assert.equal(new URL(String(input), "http://localhost").pathname, "/api/auth/me", "Sidebar must not fetch destination data")
  calls++
  return new Response(JSON.stringify({ data: { user: identity() }, success: true }), { headers: { "Content-Type": "application/json" } })
}
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const root = createRoot(document.getElementById("root")!)
function PageIdentity() { useMe(); return null }
async function render(route: string) {
  await React.act(async () => {
    root.render(<QueryClientProvider client={qc}><PathnameContext.Provider value={route}><Sidebar /><PageIdentity key={route} /></PathnameContext.Provider></QueryClientProvider>)
    await new Promise(resolve => setTimeout(resolve, 20))
  })
}
async function flush() { await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }
function routes(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? routes(path.join(directory, entry.name), `${prefix}/${entry.name}`)
    : entry.name === "page.tsx" ? [prefix || "/"] : [])
}
try {
  await render("/")
  await flush()
  assert.equal(calls, 1, "Identity requests share the existing query cache")
  const sidebar = document.querySelector("aside")!
  const logo = sidebar.querySelector("img")!
  const nav = sidebar.querySelector("nav")!
  const links = [...nav.querySelectorAll("a")]
  const allRoutes = routes(path.resolve("apps/web/next-monorepo/apps/web/app/(dashboard)"))
  for (const route of allRoutes) {
    await render(route)
    assert.equal(document.querySelector("aside"), sidebar, `Sidebar preserved at ${route}`)
    assert.equal(sidebar.querySelector("img"), logo, `Logo preserved at ${route}`)
    assert.deepEqual([...nav.querySelectorAll("a")], links, `Links preserved at ${route}`)
    for (const link of links) {
      const href = link.getAttribute("href")!
      assert.equal(link.getAttribute("aria-current"), (href === "/" ? route === "/" : route.startsWith(href)) ? "page" : null)
    }
    assert.equal(calls, 1, `No identity refetch on navigation to ${route}`)
  }
  await React.act(async () => { (document.querySelector('[aria-label="Open menu"]') as HTMLButtonElement).click() })
  assert.equal(qc.getQueryCache().find({ queryKey: ["me"] })!.getObserversCount(), 2, "One sidebar observer plus one page observer, even with drawer open")
  assert.equal(calls, 1)
  const drawer = document.querySelectorAll("aside")[1]!
  await render("/orders")
  assert.equal(document.querySelectorAll("aside")[1], drawer, "Drawer state survives route context update")
  role = "STAFF"
  await React.act(async () => { qc.setQueryData(["me"], identity()) })
  await flush()
  assert.equal(document.querySelector('a[href="/distributors"]'), null)
  assert.equal(document.querySelector('a[href="/user"]'), null)
  assert.ok(!document.body.textContent!.includes("Master Admin"))
  type = "DISTRIBUTOR"; role = "ADMIN"
  await React.act(async () => { await qc.invalidateQueries({ queryKey: ["me"] }) })
  await flush()
  assert.equal(calls, 2, "Explicit invalidation refetches identity once")
  assert.ok(document.querySelector('a[href="/partners"]'), "New permissions immediately reach desktop and mobile")
  assert.equal(drawer.querySelector('a[href="/orders"]')!.getAttribute("aria-current"), "page")
  const brandLabels = () => [...document.querySelectorAll('img[alt="ArcadeLX"]')].map(img => img.parentElement!.textContent)
  assert.ok(brandLabels().every(text => text?.includes("Distributor")), "Distributor label appears in desktop, mobile bar and drawer")
  type = "PARTNER"
  await React.act(async () => { qc.setQueryData(["me"], identity()) })
  await flush()
  assert.ok(brandLabels().every(text => text?.includes("Partner") && !text.includes("Distributor")), "Account label updates to Partner across all sidebar variants")
  document.addEventListener("click", event => event.preventDefault(), { once: true })
  await React.act(async () => { drawer.querySelector('a[href="/orders"]')!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })) })
  assert.equal(document.querySelectorAll("aside").length, 1, "Mobile navigation closes drawer")
  console.log(`PASS ${allRoutes.length} dashboard route contexts: stable sidebar/logo/link nodes, active states, one initial identity call, shared mobile subscription, cached and invalidated permission updates`)
} finally {
  await React.act(async () => root.unmount())
  qc.clear()
  dom.window.close()
}
