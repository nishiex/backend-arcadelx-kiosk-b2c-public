// Model-specific distributor/partner requests; mocked HTTP only, no live writes.
// Run from the repo root with:
//   npx tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json apps/web/next-monorepo/apps/web/scripts/order-model-availability-check.tsx
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
const { default: CreateOrderDialog } = await import("../components/orders/CreateOrderDialog")

const orgId = { value: "distributor-id" }
const supplier = { value: { id: "company-id", name: "Company Supplier", type: "COMPANY" } }
const availability = {
  value: [
    { model: "ADLX-Pro-X1", availableQuantity: 2 },
    { model: "Arcade-LX B2C", availableQuantity: 0 },
    { model: "Arcade-LX Healthcare", availableQuantity: 4 },
  ],
}
const posts: unknown[] = []
let rejectNextCreate = false
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  if (url.pathname === "/api/orders/request-models") {
    return Response.json({ data: { supplier: supplier.value, models: availability.value } })
  }
  if (url.pathname === "/api/orders/create") {
    const body = JSON.parse(String(init?.body ?? "{}"))
    posts.push(body)
    if (rejectNextCreate) {
      rejectNextCreate = false
      return Response.json({ message: "Only 1 unreserved installed kiosk is available." }, { status: 409 })
    }
    return Response.json({
      data: {
        order: {
          ...body,
          requestedModel: body.model,
          id: `order-${posts.length}`,
          orderNumber: `ORD-${posts.length}`,
          status: "UNDER_REVIEW",
          paymentStatus: "PENDING",
          parentOrgId: supplier.value.id,
          childOrgId: orgId.value,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }, { status: 201 })
  }
  throw new Error(`Unexpected request: ${url.pathname}`)
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})
const root = createRoot(document.getElementById("root")!)
const render = async (organizationId: string) => React.act(async () => {
  root.render(
    <QueryClientProvider client={queryClient}>
      <CreateOrderDialog
        organizationId={organizationId}
        orgType={organizationId === "partner-id" ? "PARTNER" : "DISTRIBUTOR"}
        disabled={false}
        onCreated={() => {}}
      />
    </QueryClientProvider>,
  )
})
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 3000
  while (!predicate() && Date.now() < deadline) {
    await React.act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  assert.ok(predicate(), "Expected UI state did not appear")
}
const setValue = async (selector: string, value: string) => {
  const element = document.querySelector(selector) as HTMLInputElement | HTMLSelectElement
  assert.ok(element)
  const prototype = element.tagName === "SELECT"
    ? w.HTMLSelectElement.prototype
    : w.HTMLInputElement.prototype
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new w.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }))
  })
}
const openAndWait = async () => {
  await React.act(async () => button("Request Kiosks")!.click())
  await until(() => !!document.querySelector('[aria-label="Kiosk model"] option[value="ADLX-Pro-X1"]'))
}
const submit = async () => React.act(async () => {
  document.querySelector("form")!.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }))
})

try {
  await render(orgId.value)
  await openAndWait()
  const modelSelect = () => document.querySelector('[aria-label="Kiosk model"]') as HTMLSelectElement
  assert.equal(modelSelect().options[2]?.disabled, true, "zero-stock model cannot be selected")
  assert.ok(button("Submit request")!.disabled, "model selection is required")
  await setValue('[aria-label="Number of containers"]', "3")
  await setValue('[aria-label="Kiosk model"]', "ADLX-Pro-X1")
  assert.ok(button("Submit request")!.disabled, "quantity exceeding model stock is blocked")
  assert.ok(document.body.textContent?.includes("Only 2 ADLX-Pro-X1"))
  await setValue('[aria-label="Number of containers"]', "2")
  await until(() => button("Submit request")?.disabled === false)
  assert.ok(document.body.textContent?.includes("Company Supplier"))
  await submit()
  await until(() => posts.length === 1 && !document.querySelector('[role="dialog"]'))
  assert.deepEqual(posts[0], { type: "REQUEST", quantity: 2, model: "ADLX-Pro-X1" })

  orgId.value = "partner-id"
  supplier.value = { id: "distributor-id", name: "Distributor Supplier", type: "DISTRIBUTOR" }
  availability.value = [{ model: "Arcade-LX Healthcare", availableQuantity: 1 }]
  queryClient.clear()
  await render(orgId.value)
  await openAndWait()
  await setValue('[aria-label="Number of containers"]', "2")
  await setValue('[aria-label="Kiosk model"]', "Arcade-LX Healthcare")
  assert.ok(button("Submit request")!.disabled, "Partner quantity cannot exceed its Distributor's stock")
  await setValue('[aria-label="Number of containers"]', "1")
  await until(() => button("Submit request")?.disabled === false)
  rejectNextCreate = true
  await submit()
  await until(() => !!document.querySelector('[role="alert"]'))
  assert.ok(button("Submit request")?.disabled === false)
  assert.equal(posts.length, 2, "stale stock is rejected by the server response and isn't retried")
  assert.deepEqual(posts[1], { type: "REQUEST", quantity: 1, model: "Arcade-LX Healthcare" })
  console.log("PASS distributor and partner model availability, required model, quantity limits, payload, and stale-stock error")
} finally {
  await React.act(async () => root.unmount())
  queryClient.clear()
  dom.window.close()
}
process.exit(0)
