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
const { createOrder, fetchOrderRequestCompanies } =
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
let releaseCreate: (() => void) | undefined
let holdCreate = false
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
          networkRejection: true,
          agreementRejection: true,
          orderDecisions: available,
        })
  if (url.pathname === "/api/orders/create") {
    if (holdCreate)
      await new Promise<void>((resolve) => {
        releaseCreate = resolve
      })
    if (rejectCreate)
      return response(null, 503, "Order requests are temporarily unavailable.")
    const order = {
      ...body,
      id: "created-order",
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
async function refreshCompanies() {
  await React.act(async () => {
    await qc.invalidateQueries({ queryKey: ["order-request-companies"] })
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
    JSON.stringify(await fetchOrderRequestCompanies(distributor.id)) ===
      JSON.stringify([company])
  )
  activeNetwork.status = "PENDING"
  check(
    "inactive-network-excludes-company",
    (await fetchOrderRequestCompanies(distributor.id)).length === 0
  )
  activeNetwork.status = "ACTIVE"
  for (const quantity of [0, 51, 1.5, NaN])
    await assert.rejects(
      createOrder({ type: "REQUEST", targetOrgId: company.id, quantity }),
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
    () => !!button("Request Containers"),
    "Distributor action appears"
  )
  check(
    "workflow-unavailable-disables-trigger",
    button("Request Containers")!.disabled
  )
  for (const deniedRole of ["MANAGER", "STAFF"]) {
    role = deniedRole
    await identity()
    check(`${deniedRole}-cannot-request`, !button("Request Containers"))
  }
  role = "OWNER"
  membershipStatus = "PENDING"
  await identity()
  check("pending-membership-cannot-request", !button("Request Containers"))
  membershipStatus = "ACTIVE"
  currentOrg = company
  await identity()
  check("company-cannot-use-distributor-request", !button("Request Containers"))
  currentOrg = { ...distributor, type: "PARTNER" }
  await identity()
  check("partner-cannot-request", !button("Request Containers"))
  currentOrg = distributor
  await identity()
  await React.act(async () => {
    available = true
    await qc.invalidateQueries({ queryKey: ["workflow-readiness"] })
  })
  await until(
    () => button("Request Containers")?.disabled === false,
    "Ready workflow enables trigger"
  )
  await click(button("Request Containers"))
  await until(
    () => button("Submit request")?.disabled === false,
    "Active company resolves"
  )
  const beforeReadinessError = posts().length
  await React.act(async () => {
    readinessError = true
    await qc.invalidateQueries({ queryKey: ["workflow-readiness"] })
  })
  await until(
    () =>
      document.body.textContent!.includes(
        "Couldn't check order action availability."
      ),
    "Readiness error reaches open request dialog"
  )
  check(
    "readiness-error-retains-previously-enabled-data",
    qc.getQueryData<{ orderDecisions: boolean }>(["workflow-readiness"])
      ?.orderDecisions === true
  )
  check(
    "readiness-error-disables-request-trigger-and-submit",
    button("Request Containers")!.disabled && button("Submit request")!.disabled
  )
  await React.act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  check(
    "readiness-error-blocks-request-post",
    posts().length === beforeReadinessError
  )
  await React.act(async () => {
    readinessError = false
    await qc.invalidateQueries({ queryKey: ["workflow-readiness"] })
  })
  await until(
    () => button("Submit request")?.disabled === false,
    "Successful readiness refetch restores request submission"
  )
  check(
    "sole-company-selected",
    (document.querySelector('[aria-label="Company"]') as HTMLSelectElement)
      .value === company.id
  )
  for (const value of ["", "0", "51", "1.5"]) {
    await setValue('[aria-label="Number of containers"]', value)
    check(
      `invalid-quantity-${value || "empty"}-disabled`,
      button("Submit request")!.disabled
    )
  }
  await setValue('[aria-label="Number of containers"]', "50")
  check("upper-bound-accepted", !button("Submit request")!.disabled)
  relationshipError = true
  await refreshCompanies()
  await until(
    () => document.body.textContent!.includes("Couldn't load your company"),
    "Relationship error appears"
  )
  check(
    "relationship-error-blocks-stale-company",
    button("Submit request")!.disabled
  )
  relationshipError = false
  activeNetwork.status = "PENDING"
  await refreshCompanies()
  await until(
    () =>
      document.body.textContent!.includes(
        "You need an active company agreement"
      ),
    "No eligible relationship explained"
  )
  check("missing-company-disables-submit", button("Submit request")!.disabled)
  activeNetwork.status = "ACTIVE"
  await refreshCompanies()
  await until(
    () => button("Submit request")?.disabled === false,
    "Company restored"
  )
  rejectCreate = true
  await click(button("Submit request"))
  await until(
    () => !!document.querySelector('[role="alert"]'),
    "Backend error appears"
  )
  check(
    "backend-error-retains-dialog-and-quantity",
    !!document.querySelector('[role="dialog"]') &&
      (
        document.querySelector(
          '[aria-label="Number of containers"]'
        ) as HTMLInputElement
      ).value === "50"
  )
  await until(
    () => button("Submit request")?.disabled === false,
    "Failed submit settles"
  )
  check("mutation-does-not-auto-retry", posts().length === 1)
  await React.act(async () => {
    available = false
    await qc.invalidateQueries({ queryKey: ["workflow-readiness"] })
  })
  await until(
    () => button("Submit request")?.disabled === true,
    "Readiness update reaches open dialog"
  )
  check(
    "readiness-change-blocks-open-dialog",
    button("Submit request")!.disabled
  )
  await React.act(async () => {
    available = true
    await qc.invalidateQueries({ queryKey: ["workflow-readiness"] })
  })
  await until(
    () => button("Submit request")?.disabled === false,
    "Workflow available again"
  )
  await click(button("Cancel"))
  check(
    "settled-failed-request-can-close",
    !document.querySelector('[role="dialog"]')
  )
  await setValue('[aria-label="Search order number"]', "unrelated")
  await setValue('[aria-label="Filter order status"]', "DELIVERED")
  await setValue('[aria-label="Filter order direction"]', "INCOMING")
  await click(button("Request Containers"))
  await until(
    () => button("Submit request")?.disabled === false,
    "Dialog reopened"
  )
  check(
    "reopening-resets-request-form-and-error",
    (
      document.querySelector(
        '[aria-label="Number of containers"]'
      ) as HTMLInputElement
    ).value === "1" && !document.querySelector('[role="alert"]')
  )
  await setValue('[aria-label="Number of containers"]', "10")
  const modelSelect = document.querySelector(
    '[aria-label="Model type (draft)"]'
  ) as HTMLSelectElement
  assert.deepEqual(
    [...modelSelect.options].map((option) => option.value).filter(Boolean),
    ["ADLX-Pro-X1", "Arcade-LX B2C", "Arcade-LX Healthcare"]
  )
  await setValue('[aria-label="Model type (draft)"]', "ADLX-Pro-X1")
  check(
    "model-draft-clearly-not-submitted",
    document
      .getElementById("request-model-hint")!
      .textContent!.includes("not saved or sent")
  )
  rejectCreate = false
  holdCreate = true
  const before = posts().length
  await React.act(async () => {
    const form = document.querySelector("form")!
    form.dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    )
    form.dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true })
    )
    // Exercise the synchronous dismissal guard before the pending render.
    button("Cancel")!.click()
    document.dispatchEvent(
      new w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    )
  })
  await until(() => !!releaseCreate, "Request starts")
  check(
    "pending-request-immediately-blocks-dismissal",
    !!document.querySelector('[role="dialog"]')
  )
  check("double-submit-sends-one-request", posts().length === before + 1)
  // HTTP starts before React Query's scheduled observer notification renders.
  // Keep the response held while waiting for the user-visible pending state.
  await until(() => !!button("Submitting..."), "Pending request renders")
  check("pending-request-cannot-close", button("Cancel")!.disabled)
  const close = document.querySelector<HTMLButtonElement>(
    '[aria-label="Close container request"]'
  )!
  check(
    "pending-request-disables-form-controls",
    close.disabled &&
      button("Submitting...")!.disabled &&
      (document.querySelector('[aria-label="Company"]') as HTMLSelectElement)
        .disabled &&
      (
        document.querySelector(
          '[aria-label="Number of containers"]'
        ) as HTMLInputElement
      ).disabled
  )
  await click(button("Cancel"))
  await click(close)
  await React.act(async () => {
    document.dispatchEvent(
      new w.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    )
  })
  check(
    "pending-request-stays-open-after-dismissal-attempts",
    !!document.querySelector('[role="dialog"]')
  )
  await React.act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
  })
  check(
    "pending-request-blocks-later-duplicate-submit",
    posts().length === before + 1
  )
  check(
    "pending-request-disables-model-draft",
    (
      document.querySelector(
        '[aria-label="Model type (draft)"]'
      ) as HTMLSelectElement
    ).disabled
  )
  await React.act(async () => {
    releaseCreate!()
  })
  await until(
    () =>
      !document.querySelector('[role="dialog"]') &&
      !!document.querySelector("tbody")?.textContent?.includes("ORD-TEST-NEW"),
    "Created request appears in refreshed list"
  )
  assert.deepEqual(posts().at(-1)!.body, {
    type: "REQUEST",
    targetOrgId: company.id,
    quantity: 10,
  })
  check(
    "request-post-includes-auth-cookies",
    posts().at(-1)!.credentials === "include"
  )
  check(
    "success-clears-filters",
    (
      document.querySelector(
        '[aria-label="Filter order status"]'
      ) as HTMLSelectElement
    ).value === "" &&
      (
        document.querySelector(
          '[aria-label="Search order number"]'
        ) as HTMLInputElement
      ).value === "" &&
      (
        document.querySelector(
          '[aria-label="Filter order direction"]'
        ) as HTMLSelectElement
      ).value === ""
  )
  check(
    "success-explains-company-approval",
    document.body.textContent!.includes("submitted for company approval")
  )
  await until(
    () =>
      button("Request Containers")?.disabled === false && qc.isMutating() === 0,
    "Successful request settles"
  )
  await click(button("Request Containers"))
  await until(
    () => button("Submit request")?.disabled === false,
    "Successful request can be reopened"
  )
  check(
    "success-reopening-resets-quantity",
    (
      document.querySelector(
        '[aria-label="Number of containers"]'
      ) as HTMLInputElement
    ).value === "1"
  )
  check(
    "success-reopening-resets-model-draft",
    (
      document.querySelector(
        '[aria-label="Model type (draft)"]'
      ) as HTMLSelectElement
    ).value === ""
  )
  await click(button("Cancel"))
  check(
    "settled-successful-request-can-close",
    !document.querySelector('[role="dialog"]')
  )
} finally {
  await React.act(async () => root.unmount())
  qc.clear()
  dom.window.close()
}
process.exit(0)
