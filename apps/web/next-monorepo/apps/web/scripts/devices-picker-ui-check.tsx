// /devices: the pricing tab has to be usable as a device picker, and the Fleet tab is
// Company-only. Mocked HTTP only, no live reads or writes.
// Run from the repo root with:
//   npx tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json apps/web/next-monorepo/apps/web/scripts/devices-picker-ui-check.tsx
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const requireTest = createRequire(path.join(os.tmpdir(), "arcadelx-ui-tests/package.json"))
const { JSDOM } = requireTest("jsdom")
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
})
const w = dom.window
for (const key of [
  "window", "document", "navigator", "HTMLElement", "HTMLInputElement",
  "HTMLSelectElement", "Element", "Node", "NodeFilter", "DocumentFragment",
  "MutationObserver", "Event", "CustomEvent", "FocusEvent", "MouseEvent",
  "getComputedStyle",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "getComputedStyle" ? w.getComputedStyle.bind(w) : w[key],
  })
}
w.matchMedia = (query: string) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
})
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const React = await import("react")
const { createRoot } = await import("react-dom/client")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { default: DevicesScreen } = await import("../components/devices/DevicesScreen")

const DEVICES = [
  { deviceId: "aaaaaaaa-1111-4111-8111-111111111111", kioskNumber: 12, isOnline: true, location: "Mumbai", lastSeen: "2026-11-05T09:30:00.000Z", hardwareUuid: null, headscaleIp: null, publicIp: null },
  { deviceId: "bbbbbbbb-2222-4222-8222-222222222222", kioskNumber: 34, isOnline: false, location: "Pune", lastSeen: "2026-11-04T18:00:00.000Z", hardwareUuid: null, headscaleIp: null, publicIp: null },
  { deviceId: "cccccccc-3333-4333-8333-333333333333", kioskNumber: null, isOnline: true, location: null, lastSeen: null, hardwareUuid: null, headscaleIp: null, publicIp: null },
]

let role: "DISTRIBUTOR" | "COMPANY" = "DISTRIBUTOR"
const me = () => ({
  id: `me-${role}`,
  email: "user@example.test",
  name: "User",
  membership: {
    organizationId: role === "COMPANY" ? "org-co" : "org-dist",
    status: "ACTIVE",
    role: "OWNER",
    organization: {
      id: role === "COMPANY" ? "org-co" : "org-dist",
      name: role === "COMPANY" ? "Company" : "Northwind Distribution",
      type: role,
    },
  },
  permissions: [] as string[],
})

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const method = init?.method ?? "GET"
  if (url.pathname === "/api/auth/me") return Response.json({ data: { user: me() } })
  if (url.pathname === "/api/devices/price-requests") return Response.json({ data: { requests: [] } })
  if (url.pathname === "/api/devices" && method === "GET") {
    return Response.json({
      data: { devices: DEVICES, lastUpdated: "2026-11-05T09:35:00.000Z", total: DEVICES.length },
    })
  }
  if (/^\/api\/devices\/[^/]+\/prices$/.test(url.pathname)) {
    return Response.json({
      data: { deviceId: "x", games: [], kioskStatus: "INSTALLED", eod: {}, eodMeta: { timezone: "Asia/Kolkata", runTime: "00:05", nextExecutionAt: "2026-11-06T00:05:00.000Z" } },
    })
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`)
}

const bodyText = () => document.body.textContent ?? ""
const until = async (predicate: () => boolean, why = "the UI") => {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  }
  throw new Error(`timed out waiting for ${why}`)
}

async function render(): Promise<{ root: ReturnType<typeof createRoot>; client: InstanceType<typeof QueryClient> }> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await React.act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <DevicesScreen />
      </QueryClientProvider>,
    )
  })
  return { root, client }
}

// --- Distributor: no Fleet tab, and the picker is readable + filterable -------------
{
  role = "DISTRIBUTOR"
  const { root, client } = await render()
  await until(() => bodyText().includes("Kiosk #12"), "the pricing picker")

  assert.ok(!bodyText().includes("Fleet"), "a distributor is not offered the Fleet tab")
  assert.ok(bodyText().includes("Game pricing"), "the pricing tab is still there")
  assert.equal(document.querySelector("select#pricing-device"), null, "the UUID select is gone")

  assert.ok(bodyText().includes("Kiosk #34"), "every device is listed")
  assert.ok(bodyText().includes("Device cccccccc"), "a device without a kiosk number falls back to its short id")
  assert.ok(bodyText().includes("Mumbai"), "the picker shows the device location")
  assert.ok(bodyText().includes("Online") && bodyText().includes("Offline"), "online state is visible")
  assert.ok(bodyText().includes("3 of 3"), "the picker states how many devices it is showing")

  const search = document.querySelector('input[type="search"]') as HTMLInputElement
  assert.ok(search, "the picker has a search box")
  await React.act(async () => {
    const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")!.set!
    setter.call(search, "pune")
    search.dispatchEvent(new w.Event("input", { bubbles: true }))
  })
  await until(() => bodyText().includes("1 of 3"), "the picker to filter")

  assert.ok(bodyText().includes("Kiosk #34"), "the matching device survives the filter")
  assert.ok(!bodyText().includes("Kiosk #12"), "a non-matching device is filtered out")
  assert.ok(bodyText().includes("1 of 3"), "the count reflects the filter")

  console.log("PASS devices UI: distributor gets a searchable picker and no Fleet tab")

  await React.act(async () => root.unmount())
  client.clear()
}

// --- Company: the Fleet tab is still there ------------------------------------------
{
  role = "COMPANY"
  const { root, client } = await render()
  await until(() => bodyText().includes("Fleet"), "the company device screen")

  assert.ok(bodyText().includes("Fleet"), "a Company viewer keeps the Fleet tab")
  assert.ok(bodyText().includes("Game pricing"), "the company keeps both tabs")

  // Company lands on Fleet, so the picker only appears after switching tabs.
  await React.act(async () => {
    const tab = [...document.querySelectorAll("button")].find(
      item => item.textContent?.trim() === "Game pricing",
    )
    assert.ok(tab, "the pricing tab is clickable")
    tab!.click()
  })
  await until(() => bodyText().includes("Kiosk #12"), "the picker after switching tabs")

  console.log("PASS devices UI: company keeps the Fleet tab")

  await React.act(async () => root.unmount())
  client.clear()
}

dom.window.close()
process.exit(0)
