// /kiosks default view: only paired machines, with the unpaired rows one click away.
// Mocked HTTP only, no live reads or writes.
// Run from the repo root with:
//   npx tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json apps/web/next-monorepo/apps/web/scripts/kiosks-paired-only-ui-check.tsx
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

const React = await import("react")
const { createRoot } = await import("react-dom/client")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { default: KiosksScreen } = await import("../components/kiosks/KiosksScreen")

const ORG = "org-1"
const me = {
  id: "me-1",
  email: "owner@example.test",
  name: "Owner",
  membership: {
    organizationId: ORG,
    status: "ACTIVE",
    role: "OWNER",
    organization: { id: ORG, name: "Company", type: "COMPANY" },
  },
  permissions: [] as string[],
}

const base = {
  model: "ArcadeLX",
  status: "ACTIVE",
  location: "Mumbai",
  currentOrgId: ORG,
  currentOrg: { id: ORG, name: "Company", type: "COMPANY" },
  assignedOrg: null,
}

const kiosks = [
  { ...base, id: "k1", machineCode: "ADLX-PAIRED-1", externalDeviceId: "dev-1" },
  { ...base, id: "k2", machineCode: "ADLX-PAIRED-2", externalDeviceId: "dev-2" },
  { ...base, id: "k3", machineCode: "ADLX-UNPAIRED-1", externalDeviceId: null },
]

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const method = init?.method ?? "GET"
  if (url.pathname === "/api/auth/me") return Response.json({ data: { user: me } })
  if (url.pathname === "/api/kiosks" && method === "GET") {
    return Response.json({ data: { kiosks, meta: { totalPages: 1 } } })
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`)
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})
const root = createRoot(document.getElementById("root")!)
const render = async () => React.act(async () => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <KiosksScreen />
    </QueryClientProvider>,
  )
})
const until = async (predicate: () => boolean) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error("timed out waiting for the UI")
}
const bodyText = () => document.body.textContent ?? ""
const pairedToggle = () =>
  [...document.querySelectorAll("input[type=checkbox]")].find((el) =>
    el.closest("label")?.textContent?.includes("Paired only"),
  ) as HTMLInputElement | undefined

try {
  await render()
  await until(() => bodyText().includes("ADLX-PAIRED-1"))

  assert.ok(!bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine is hidden by default")
  assert.ok(bodyText().includes("ADLX-PAIRED-2"), "every paired machine is listed")
  const toggle = pairedToggle()
  assert.ok(toggle, "the paired-only toggle is offered")
  assert.equal(toggle!.checked, true, "the toggle starts on")
  assert.ok(bodyText().includes("(2/3)"), "the toggle states how many machines are paired")

  await React.act(async () => toggle!.click())
  await until(() => bodyText().includes("ADLX-UNPAIRED-1"))
  assert.ok(bodyText().includes("ADLX-UNPAIRED-1"), "unticking the toggle reveals the unpaired machine")

  console.log("PASS kiosks UI: paired machines by default, unpaired one click away")
} finally {
  await React.act(async () => root.unmount())
  queryClient.clear()
  dom.window.close()
}
process.exit(0)
