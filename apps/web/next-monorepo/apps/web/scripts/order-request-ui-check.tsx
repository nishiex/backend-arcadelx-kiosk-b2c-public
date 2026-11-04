// In-memory component integration checks; no live API or database writes.
// Uses jsdom from %TEMP%/arcadelx-ui-tests, like decision-ui-check.tsx.
// Run with tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json <this-file>.
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"

const requireTest = createRequire(
  path.join(os.tmpdir(), "arcadelx-ui-tests/package.json")
)
const { JSDOM } = requireTest("jsdom")
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
})
const w = dom.window
w.matchMedia = (query: string) => ({
  matches: query.includes("prefers-reduced-motion"),
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
})
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "Element",
  "Node",
  "NodeFilter",
  "DocumentFragment",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "FocusEvent",
  "getComputedStyle",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: key === "getComputedStyle" ? w.getComputedStyle.bind(w) : w[key],
  })
}
globalThis.requestAnimationFrame = w.requestAnimationFrame.bind(w)
globalThis.cancelAnimationFrame = w.cancelAnimationFrame.bind(w)
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const React = await import("react")
const { createRoot } = await import("react-dom/client")
const { QueryClient, QueryClientProvider } =
  await import("@tanstack/react-query")
const { default: OrdersScreen } =
  await import("../components/orders/OrdersScreen")
const { createOrder, fetchOrderRequestSuppliers } =
  await import("../lib/backend-api")
const distributor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Test Distributor",
  type: "DISTRIBUTOR",
}
const company = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Supplier Company",
  type: "COMPANY",
}
let currentOrg = distributor
let role = "ADMIN"
let membershipStatus = "ACTIVE"
let available = false
let readinessError = false
let relationshipError = false
let rejectCreate = false
const calls: {
  path: string
  method: string
  body: unknown
  credentials?: RequestCredentials
}[] = []
const activeAgreement = {
  id: "agreement",
  status: "ACTIVE",
  parentOrg: company,
  childOrg: distributor,
}
const activeNetwork = {
  id: "network",
  status: "ACTIVE",
  initiator: company,
  reciever: distributor,
}
const agreements = [
  ...Array.from({ length: 20 }, (_, i) => ({
    ...activeAgreement,
    id: `old-${i}`,
    status: "TERMINATED",
  })),
  activeAgreement,
  { ...activeAgreement, id: "duplicate" },
  { ...activeAgreement, id: "other-child", childOrg: company },
  { ...activeAgreement, id: "wrong-parent", parentOrg: distributor },
]
const networks = [
  ...Array.from({ length: 20 }, (_, i) => ({
    ...activeNetwork,
    id: `old-${i}`,
    status: "REJECTED",
  })),
  activeNetwork,
]
const orders: Record<string, unknown>[] = []
const me = () => ({
  id: "user",
  membership: {
    status: membershipStatus,
    role,
    organizationId: currentOrg.id,
    organization: currentOrg,
  },
})
const response = (data: unknown, status = 200, message = "") =>
  new Response(JSON.stringify({ success: status < 400, data, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  })
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const method = init?.method ?? "GET"
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  calls.push({
    path: url.pathname + url.search,
    method,
    body,
    credentials: init?.credentials,
  })
  if (url.pathname === "/api/auth/me") return response({ user: me() })
  if (url.pathname === "/api/workflows")
    return readinessError
      ? response(null, 503, "Readiness unavailable")
      : response({
          orderDecisions: available,
        })
  if (url.pathname === "/api/orders/request-models")
    return response({
      supplier:
        currentOrg.type === "PARTNER"
          ? { id: "supplier-distributor", name: "Supplier Distributor", type: "DISTRIBUTOR" }
          : company,
      models: [
        { model: "ADLX-Pro-X1", availableQuantity: 50 },
        { model: "Arcade-LX B2C", availableQuantity: 0 },
        { model: "Arcade-LX Healthcare", availableQuantity: 0 },
      ],
    })
  if (url.pathname === "/api/orders/create") {
    if (rejectCreate)
      return response(null, 503, "Order requests are temporarily unavailable.")
    const order = {
      ...body,
      requestedModel: body.model,
      id: `created-order-${orders.length}`,
      orderNumber: "ORD-TEST-NEW",
      status: "UNDER_REVIEW",
      paymentStatus: "PENDING",
      parentOrgId: company.id,
      childOrgId: distributor.id,
      parentOrg: company,
      childOrg: distributor,
      createdAt: new Date().toISOString(),
    }
    orders.push(order)
    return response({ order }, 201)
  }
  if (url.pathname === "/api/orders")
    return response({
      orders: orders.filter(
        (order) =>
          !url.searchParams.get("status") ||
          order.status === url.searchParams.get("status")
      ),
    })
  if (url.pathname === "/api/agreements" || url.pathname === "/api/network") {
    if (relationshipError)
      return response(null, 500, "Cannot load relationships")
    const page = Number(url.searchParams.get("page"))
    const rows = url.pathname === "/api/agreements" ? agreements : networks
    return response({
      [url.pathname === "/api/agreements" ? "agreements" : "requests"]:
        rows.slice((page - 1) * 20, page * 20),
      meta: {
        page,
        limit: 20,
        total: rows.length,
        totalPages: Math.ceil(rows.length / 20),
      },
    })
  }
  throw new Error(`Unexpected request: ${url.pathname}`)
}
const qc = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})
const root = createRoot(document.getElementById("root")!)
const check = (name: string, pass: boolean) => {
  assert.ok(pass, name)
  console.log("PASS", name)
}
async function until(test: () => boolean, description: string) {
  const end = Date.now() + 4000
  while (!test() && Date.now() < end)
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  assert.ok(test(), description)
}
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === name
  )
async function click(item: HTMLElement | undefined) {
  assert.ok(item)
  await React.act(async () => item.click())
}
async function identity() {
  await React.act(async () => {
    qc.setQueryData(["me"], me())
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}
async function setValue(selector: string, value: string) {
  const input = document.querySelector(selector) as
    HTMLInputElement | HTMLSelectElement
  assert.ok(input)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === "SELECT"
        ? w.HTMLSelectElement.prototype
        : w.HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value)
    input.dispatchEvent(
      new w.Event(input.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      })
    )
  })
}
const posts = () => calls.filter((call) => call.path === "/api/orders/create")
try {
  check(
    "company-resolved-after-history-pages-and-deduplicated",
    JSON.stringify(await fetchOrderRequestSuppliers(distributor.id, "DISTRIBUTOR")) ===
      JSON.stringify([company])
  )
  activeNetwork.status = "PENDING"
  check(
    "inactive-network-excludes-company",
    (await fetchOrderRequestSuppliers(distributor.id, "DISTRIBUTOR")).length === 0
  )
  activeNetwork.status = "ACTIVE"
  const supplierType = company.type
  company.type = "DISTRIBUTOR"
  check("partner-can-select-distributor-supplier", (await fetchOrderRequestSuppliers(distributor.id, "PARTNER")).length === 1)
  check("distributor-cannot-select-distributor-supplier", (await fetchOrderRequestSuppliers(distributor.id, "DISTRIBUTOR")).length === 0)
  company.type = supplierType
  for (const quantity of [0, 51, 1.5, NaN])
    await assert.rejects(
      createOrder({ type: "REQUEST", quantity, model: "ADLX-Pro-X1" }),
      /whole number/
    )
  check("invalid-helper-quantities-send-no-post", posts().length === 0)
  await React.act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <OrdersScreen />
      </QueryClientProvider>
    )
  )
  await until(
    () => !!button("Request Kiosks"),
    "Distributor action appears"
  )
  check(
    "workflow-unavailable-disables-trigger",
    button("Request Kiosks")!.disabled
  )
  for (const deniedRole of ["MANAGER", "STAFF"]) {
    role = deniedRole
    await identity()
    check(`${deniedRole}-cannot-request`, !button("Request Kiosks"))
  }
  role = "OWNER"
  membershipStatus = "PENDING"
  await identity()
  check("pending-membership-cannot-request", !button("Request Kiosks"))
  membershipStatus = "ACTIVE"
  currentOrg = company
  await identity()
  check("company-cannot-use-distributor-request", !button("Request Kiosks"))
  currentOrg = { ...distributor, type: "PARTNER" }
  await identity()
  check("partner-owner-can-request", !!button("Request Kiosks"))
  role = "ADMIN"
  await identity()
  check("partner-admin-can-request", !!button("Request Kiosks"))
  for (const deniedRole of ["MANAGER", "STAFF"]) {
    role = deniedRole
    await identity()
    check(`partner-${deniedRole}-cannot-request`, !button("Request Kiosks"))
  }
  role = "OWNER"
  currentOrg = distributor
  await identity()
  await React.act(async () => {
    available = true
    await qc.invalidateQueries({ queryKey: ["workflow-readiness"] })
  })
  await until(
    () => button("Request Kiosks")?.disabled === false,
    "Ready workflow enables trigger"
  )
  await click(button("Request Kiosks"))
  await until(
    () => !!document.querySelector('[aria-label="Kiosk model"] option[value="ADLX-Pro-X1"]'),
    "Immediate supplier model availability loads"
  )
  await until(
    () => document.body.textContent!.includes("Availability at Supplier Company"),
    "Supplier stock is displayed"
  )
  await setValue('[aria-label="Kiosk model"]', "ADLX-Pro-X1")
  await until(
    () => button("Submit request")?.disabled === false,
    "Available model enables request"
  )
  const before = posts().length
  await click(button("Submit request"))
  await until(
    () =>
      posts().length === before + 1 &&
      !document.querySelector('[role="dialog"]'),
    "Model-specific request submits"
  )
  assert.deepEqual(posts().at(-1)!.body, {
    type: "REQUEST",
    quantity: 1,
    model: "ADLX-Pro-X1",
  })
  check("request-post-includes-auth-cookies", posts().at(-1)!.credentials === "include")
  check("request-persists-selected-model", orders.at(-1)?.requestedModel === "ADLX-Pro-X1")
  currentOrg = { ...distributor, type: "PARTNER" }
  role = "ADMIN"
  company.type = "DISTRIBUTOR"
  await React.act(async () => {
    qc.clear()
  })
  await identity()
  await click(button("Request Kiosks"))
  await until(
    () => document.body.textContent!.includes("Availability at Supplier Distributor"),
    "Partner sees immediate Distributor supplier stock"
  )
  await setValue('[aria-label="Kiosk model"]', "ADLX-Pro-X1")
  await until(() => button("Submit request")?.disabled === false, "Partner model is available")
  const partnerPostsBefore = posts().length
  await click(button("Submit request"))
  await until(() => posts().length === partnerPostsBefore + 1 && !document.querySelector('[role="dialog"]'), "Partner request submitted")
  assert.deepEqual(posts().at(-1)?.body, { type: "REQUEST", quantity: 1, model: "ADLX-Pro-X1" })
  check("partner-admin-submits-request-to-distributor", true)
  company.type = supplierType
} finally {
  await React.act(async () => root.unmount())
  qc.clear()
  dom.window.close()
}
process.exit(0)
