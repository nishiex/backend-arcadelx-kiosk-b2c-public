// /kiosks: paired machines by default, and minting a machine must not look like a no-op.
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
;(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

let minted = false
const kiosks = () => [
  { ...base, id: "k1", machineCode: "ADLX-PAIRED-1", externalDeviceId: "dev-1" },
  { ...base, id: "k2", machineCode: "ADLX-PAIRED-2", externalDeviceId: "dev-2" },
  { ...base, id: "k3", machineCode: "ADLX-UNPAIRED-1", externalDeviceId: null },
  ...(minted ? [{ ...base, id: "k4", machineCode: "ADLX-MINTED-1", externalDeviceId: null }] : []),
]

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const method = init?.method ?? "GET"
  if (url.pathname === "/api/auth/me") return Response.json({ data: { user: me } })
  if (url.pathname === "/api/kiosks" && method === "GET") {
    return Response.json({ data: { kiosks: kiosks(), meta: { totalPages: 1 } } })
  }
  if (url.pathname === "/api/kiosks/batch" && method === "POST") {
    minted = true
    return Response.json({
      data: { count: 1, startCode: "ADLX-MINTED-1", endCode: "ADLX-MINTED-1" },
    })
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
const until = async (predicate: () => boolean, why = "the UI") => {
  for (let i = 0; i < 400; i += 1) {
    if (predicate()) return
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`timed out waiting for ${why}`)
}
const bodyText = () => document.body.textContent ?? ""
const allButtons = () => [...document.querySelectorAll("button")]
const button = (label: string) => allButtons().find((item) => item.textContent?.trim() === label)
const pairedToggle = () =>
  [...document.querySelectorAll("input[type=checkbox]")].find((el) =>
    el.closest("label")?.textContent?.includes("Paired only"),
  ) as HTMLInputElement | undefined

try {
  await render()
  await until(() => bodyText().includes("ADLX-PAIRED-1"))

  assert.ok(!bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine is hidden by default")
  assert.ok(!bodyText().includes("Model"), "the machines table no longer shows a model column")
  assert.ok(bodyText().includes("ADLX-PAIRED-2"), "every paired machine is listed")
  const toggle = pairedToggle()
  assert.ok(toggle, "the paired-only toggle is offered")
  assert.equal(toggle!.checked, true, "the toggle starts on")
  assert.ok(bodyText().includes("(2/3)"), "the toggle states how many machines are paired")

  await React.act(async () => toggle!.click())
  await until(() => bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine to appear")
  assert.ok(bodyText().includes("ADLX-UNPAIRED-1"), "unticking the toggle reveals the unpaired machine")

  // Mint a machine: it is unpaired by definition, so the list must widen instead of freezing.
  await React.act(async () => toggle!.click())
  await until(() => !bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine to hide again")

  const addButton = button("Add Machine")
  assert.ok(addButton, "the mint action is offered")
  await React.act(async () => addButton!.click())
  await until(() => !!button("Mint Machine"), "the mint dialog")

  await React.act(async () => button("Mint Machine")!.click())
  await until(() => bodyText().includes("ADLX-MINTED-1"), "the minted machine to appear")

  assert.ok(bodyText().includes("ADLX-MINTED-1"), "a freshly minted machine is shown without extra clicks")
  assert.equal(pairedToggle()!.checked, false, "minting widens the filter so the new machine is visible")

  console.log("PASS kiosks UI: paired by default, unpaired one click away, minting reveals the new machine")
} finally {
  await React.act(async () => root.unmount())
  queryClient.clear()
  dom.window.close()
}
process.exit(0)
