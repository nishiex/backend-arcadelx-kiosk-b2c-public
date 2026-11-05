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
const pairingFilter = () =>
  [...document.querySelectorAll("select")].find((el) =>
    el.closest("label")?.textContent?.includes("Pairing"),
  ) as HTMLSelectElement | undefined
const choosePairing = async (value: "paired" | "all") => {
  const filter = pairingFilter()
  assert.ok(filter, "the pairing dropdown is rendered")
  await React.act(async () => {
    filter!.value = value
    filter!.dispatchEvent(new w.Event("change", { bubbles: true }))
  })
}

try {
  await render()
  await until(() => bodyText().includes("ADLX-PAIRED-1"))

  assert.ok(!bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine is hidden by default")
  assert.ok(!bodyText().includes("Model"), "the machines table no longer shows a model column")
  assert.ok(bodyText().includes("ADLX-PAIRED-2"), "every paired machine is listed")
  const filter = pairingFilter()
  assert.ok(filter, "the pairing filter is offered as a dropdown")
  assert.equal(filter!.value, "paired", "the dropdown starts on Paired only")
  assert.ok(bodyText().includes("(2/3)"), "the dropdown states how many machines are paired")

  await choosePairing("all")
  await until(() => bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine to appear")
  assert.ok(bodyText().includes("ADLX-UNPAIRED-1"), "choosing All machines reveals the unpaired machine")
  assert.ok(bodyText().includes("Pairing"), "the table names the pairing column")
  assert.ok(bodyText().includes("Unpaired"), "the unpaired machine is labelled Unpaired")
  assert.ok(bodyText().includes("Paired"), "a paired machine is labelled Paired")

  // Mint a machine: it is unpaired by definition, so the list must widen instead of freezing.
  await choosePairing("paired")
  await until(() => !bodyText().includes("ADLX-UNPAIRED-1"), "the unpaired machine to hide again")

  const addButton = button("Add Machine")
  assert.ok(addButton, "the mint action is offered")
  await React.act(async () => addButton!.click())
  await until(() => !!button("Mint Machine"), "the mint dialog")

  await React.act(async () => button("Mint Machine")!.click())
  await until(() => bodyText().includes("ADLX-MINTED-1"), "the minted machine to appear")

  assert.ok(bodyText().includes("ADLX-MINTED-1"), "a freshly minted machine is shown without extra clicks")
  assert.equal(pairingFilter()!.value, "all", "minting widens the filter so the new machine is visible")

  console.log("PASS kiosks UI: paired by default, unpaired one click away, minting reveals the new machine")
} finally {
  await React.act(async () => root.unmount())
  queryClient.clear()
}

// ---------------------------------------------------------------------------
// Distributor view: own stock plus the machines it assigned to a child org.
// The API scopes those rows, so the screen must keep them and show who holds them.
// ---------------------------------------------------------------------------
{
  const DIST = "org-dist"
  const PARTNER = "org-partner"
  const distMe = {
    id: "me-2",
    email: "dist@example.test",
    name: "Distributor Owner",
    membership: {
      organizationId: DIST,
      status: "ACTIVE",
      role: "OWNER",
      organization: { id: DIST, name: "Northwind Distribution", type: "DISTRIBUTOR" },
    },
    permissions: [] as string[],
  }
  const distOrg = { id: DIST, name: "Northwind Distribution", type: "DISTRIBUTOR" }
  const partnerOrg = { id: PARTNER, name: "Acme Arcade Partner", type: "PARTNER" }
  const distKiosks = [
    {
      ...base,
      id: "d1",
      machineCode: "ADLX-DIST-OWN-1",
      externalDeviceId: "dev-9",
      currentOrgId: DIST,
      currentOrg: distOrg,
      assignedAt: "2025-01-15T09:00:00.000Z",
    },
    {
      ...base,
      id: "d2",
      machineCode: "ADLX-DIST-PARTNER-1",
      externalDeviceId: "dev-8",
      currentOrgId: PARTNER,
      currentOrg: partnerOrg,
      assignedOrg: partnerOrg,
      assignedAt: "2025-03-12T09:00:00.000Z",
    },
  ]

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost")
    const method = init?.method ?? "GET"
    if (url.pathname === "/api/auth/me") return Response.json({ data: { user: distMe } })
    if (url.pathname === "/api/kiosks" && method === "GET") {
      return Response.json({ data: { kiosks: distKiosks, meta: { totalPages: 1 } } })
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  }

  const distClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const distRoot = createRoot(host)
  await React.act(async () => {
    distRoot.render(
      <QueryClientProvider client={distClient}>
        <KiosksScreen />
      </QueryClientProvider>,
    )
  })
  await until(() => bodyText().includes("ADLX-DIST-PARTNER-1"), "the distributor inventory")

  const rowText = (code: string) =>
    [...document.querySelectorAll("tbody tr")].map((row) => row.textContent ?? "").find((row) => row.includes(code)) ?? ""

  const ownRow = rowText("ADLX-DIST-OWN-1")
  const partnerRow = rowText("ADLX-DIST-PARTNER-1")

  assert.ok(ownRow, "a distributor still sees its own stock")
  assert.ok(ownRow.includes("Your inventory"), "own stock reads as the viewer's inventory")
  assert.ok(ownRow.includes("Jan 2025"), "own stock shows when it arrived")

  assert.ok(partnerRow, "a machine placed with a child org stays visible to the distributor")
  assert.ok(partnerRow.includes("Acme Arcade Partner"), "the child org currently holding it is named")
  assert.ok(partnerRow.includes("Partner"), "the child org type is shown")
  assert.ok(partnerRow.includes("Mar 2025"), "the assignment date is shown")
  assert.ok(bodyText().includes("Assigned"), "the table has an assignment column")

  console.log("PASS distributor kiosks UI: own stock and assigned machines, with holder org and date")

  await React.act(async () => distRoot.unmount())
  distClient.clear()
}

// ---------------------------------------------------------------------------
// Company master admin: the same view one level up — the whole chain, company stock included.
// ---------------------------------------------------------------------------
{
  const CO = "org-co"
  const DIST = "org-dist-2"
  const PARTNER = "org-partner-2"
  const ownerMe = {
    id: "me-3",
    email: "owner@example.test",
    name: "Company Owner",
    membership: {
      organizationId: CO,
      status: "ACTIVE",
      role: "OWNER",
      organization: { id: CO, name: "Company", type: "COMPANY" },
    },
    permissions: [] as string[],
  }
  const coOrg = { id: CO, name: "Company", type: "COMPANY" }
  const distOrg = { id: DIST, name: "Northwind Distribution", type: "DISTRIBUTOR" }
  const partnerOrg = { id: PARTNER, name: "Acme Arcade Partner", type: "PARTNER" }
  const fleet = [
    {
      ...base,
      id: "c1",
      machineCode: "ADLX-CO-1",
      externalDeviceId: "dev-1",
      currentOrgId: CO,
      currentOrg: coOrg,
      assignedAt: "2024-11-02T09:00:00.000Z",
    },
    {
      ...base,
      id: "c2",
      machineCode: "ADLX-CO-DIST-1",
      externalDeviceId: "dev-2",
      currentOrgId: DIST,
      currentOrg: distOrg,
      assignedOrg: distOrg,
      assignedAt: "2025-02-20T09:00:00.000Z",
    },
    {
      ...base,
      id: "c3",
      machineCode: "ADLX-CO-PARTNER-1",
      externalDeviceId: "dev-3",
      currentOrgId: PARTNER,
      currentOrg: partnerOrg,
      assignedOrg: partnerOrg,
      assignedAt: "2025-04-05T09:00:00.000Z",
    },
  ]

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost")
    const method = init?.method ?? "GET"
    if (url.pathname === "/api/auth/me") return Response.json({ data: { user: ownerMe } })
    if (url.pathname === "/api/kiosks" && method === "GET") {
      return Response.json({ data: { kiosks: fleet, meta: { totalPages: 1 } } })
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`)
  }

  const coClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const host = document.createElement("div")
  document.body.append(host)
  const coRoot = createRoot(host)
  await React.act(async () => {
    coRoot.render(
      <QueryClientProvider client={coClient}>
        <KiosksScreen />
      </QueryClientProvider>,
    )
  })
  await until(() => bodyText().includes("ADLX-CO-PARTNER-1"), "the whole fleet")

  const rowText = (code: string) =>
    [...document.querySelectorAll("tbody tr")].map((row) => row.textContent ?? "").find((row) => row.includes(code)) ?? ""

  const stockRow = rowText("ADLX-CO-1")
  const distRow = rowText("ADLX-CO-DIST-1")
  const partnerRow = rowText("ADLX-CO-PARTNER-1")

  assert.ok(stockRow.includes("Unassigned"), "company stock still reads as unassigned")
  assert.ok(stockRow.includes("Nov 2024"), "company stock shows its assignment date")

  assert.ok(distRow.includes("Northwind Distribution"), "a machine with a distributor names it")
  assert.ok(distRow.includes("Distributor"), "a distributor-held machine is labelled")
  assert.ok(distRow.includes("Feb 2025"), "a distributor-held machine shows the date")

  assert.ok(partnerRow.includes("Acme Arcade Partner"), "a machine down at a partner names it")
  assert.ok(partnerRow.includes("Partner"), "a partner-held machine is labelled")
  assert.ok(partnerRow.includes("Apr 2025"), "a partner-held machine shows the date")

  console.log("PASS master admin kiosks UI: whole chain visible, holder org and date on every row")

  await React.act(async () => coRoot.unmount())
  coClient.clear()
}

dom.window.close()
process.exit(0)
