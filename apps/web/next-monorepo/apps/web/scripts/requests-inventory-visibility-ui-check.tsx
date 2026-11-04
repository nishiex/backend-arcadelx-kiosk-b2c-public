// Requests → network: only the Company OWNER sees the counterparty's kiosk inventory.
// Mocked HTTP only. Run from the repo root with:
//   npx tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json apps/web/next-monorepo/apps/web/scripts/requests-inventory-visibility-ui-check.tsx
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
const { default: ReviewRequestList } = await import("../components/requests/ReviewRequestList")

const ORG = "org-1"
const CHILD = "org-2"

let orgType: "COMPANY" | "DISTRIBUTOR" = "DISTRIBUTOR"

const me = () => ({
  id: "me-1",
  email: "owner@example.test",
  name: "Owner",
  membership: {
    organizationId: ORG,
    status: "ACTIVE",
    role: "OWNER",
    organization: { id: ORG, name: "Acme", type: orgType },
  },
  permissions: ["NETWORK:READ", "NETWORK:WRITE"],
})

const request = {
  id: "req-1",
  status: "PENDING",
  createdAt: "2026-11-04T00:00:00.000Z",
  initiator: {
    id: ORG,
    name: "Acme",
    type: orgType,
    kiosks: [{ machineCode: "ADLX-2026-A001", model: "ArcadeLX" }],
  },
  reciever: {
    id: CHILD,
    name: "Partner Co",
    type: "PARTNER",
    kiosks: [{ machineCode: "ADLX-2026-A009", model: "ArcadeLX" }],
  },
}

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const method = init?.method ?? "GET"
  if (url.pathname === "/api/auth/me") return Response.json({ data: { user: me() } })
  if (url.pathname === "/api/network" && method === "GET") {
    return Response.json({
      data: { requests: [request], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } },
    })
  }
  throw new Error(`Unexpected request: ${method} ${url.pathname}`)
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const root = createRoot(document.getElementById("root")!)

const until = async (predicate: () => boolean, why = "the UI") => {
  for (let i = 0; i < 300; i += 1) {
    if (predicate()) return
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
  }
  throw new Error(`timed out waiting for ${why}`)
}

const renderAs = async (type: "COMPANY" | "DISTRIBUTOR") => {
  orgType = type
  queryClient.clear()
  await React.act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ReviewRequestList kind="network" page={1} onPageChange={() => {}} />
      </QueryClientProvider>,
    )
  })
  await until(() => (document.body.textContent ?? "").includes("Acme"), `the ${type} request row`)
}

try {
  await renderAs("DISTRIBUTOR")
  const distributorText = document.body.textContent ?? ""
  assert.ok(!distributorText.includes("Assigned kiosk inventory"), "a Distributor must not see the counterparty's kiosk inventory")
  assert.ok(!distributorText.includes("ADLX-2026-A009"), "the partner's machine codes stay hidden from a Distributor")

  await renderAs("COMPANY")
  const companyText = document.body.textContent ?? ""
  assert.ok(companyText.includes("Assigned kiosk inventory"), "the Company owner still sees the inventory")
  assert.ok(companyText.includes("ADLX-2026-A009"), "the Company owner sees the machine codes")

  console.log("PASS requests UI: kiosk inventory visible to the Company owner only")
} finally {
  await React.act(async () => root.unmount())
  queryClient.clear()
  dom.window.close()
}
process.exit(0)
