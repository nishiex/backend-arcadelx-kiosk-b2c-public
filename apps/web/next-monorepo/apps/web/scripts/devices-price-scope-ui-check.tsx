// Devices price scopes in the UI: device-only by default, an explicit confirmed fleet-wide
// action, and a clear report when Mothership does not persist a device override.
// Mocked HTTP only, no live writes.
// Run from the repo root with:
//   npx tsx --tsconfig apps/web/next-monorepo/apps/web/tsconfig.json apps/web/next-monorepo/apps/web/scripts/devices-price-scope-ui-check.tsx
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
const { default: DevicesScreen } = await import("../components/devices/DevicesScreen")

const DEVICE_ID = "D1"
const GAME_ID = "Brick Blast"

const me = {
  id: "me-1",
  email: "owner@example.test",
  name: "Owner",
  membership: {
    organizationId: "org-1",
    status: "ACTIVE",
    role: "OWNER",
    organization: { id: "org-1", name: "Company", type: "COMPANY" },
  },
  permissions: [] as string[],
}

const game = {
  gameId: GAME_ID,
  displayName: GAME_ID,
  basePrice: 100,
  baseReplayPrice: 50,
  effectivePrice: 100,
  effectiveReplayPrice: 50,
  hasOverride: false,
  overridePrice: null,
  overrideReplayPrice: null,
  mergedRows: 1,
}

type PostRecord = { path: string; price?: number; replay_price?: number; scope?: string }
const posts: PostRecord[] = []

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost")
  const method = init?.method ?? "GET"

  if (url.pathname === "/api/auth/me") {
    return Response.json({ data: { user: me } })
  }
  if (url.pathname === "/api/devices" && method === "GET") {
    return Response.json({
      data: {
        devices: [
          {
            deviceId: DEVICE_ID,
            hardwareUuid: null,
            headscaleIp: null,
            isOnline: true,
            kioskNumber: 1,
            lastSeen: null,
            location: null,
            publicIp: null,
          },
        ],
        lastUpdated: null,
        total: 1,
      },
    })
  }
  if (url.pathname === `/api/devices/${DEVICE_ID}/prices` && method === "GET") {
    return Response.json({ data: { deviceId: DEVICE_ID, games: [game] } })
  }
  if (
    url.pathname === `/api/devices/${DEVICE_ID}/games/${encodeURIComponent(GAME_ID)}/price` &&
    method === "POST"
  ) {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      price?: number
      replay_price?: number
      scope?: string
    }
    posts.push({ path: url.pathname, ...body })
    if (body.scope === "GAME_CATALOG") {
      return Response.json({
        data: {
          deviceId: DEVICE_ID,
          gameId: GAME_ID,
          displayName: GAME_ID,
          price: body.price,
          replayPrice: body.replay_price,
          scope: "GAME_CATALOG",
        },
      })
    }
    // Mirrors the live API reply for a device override the read-back does not confirm.
    return Response.json(
      {
        success: false,
        message:
          "Mothership did not confirm the requested device prices in its readback",
        errors: {
          requested: { price: body.price, replayPrice: body.replay_price },
          observed: {
            price: 100,
            replayPrice: 50,
            hasOverride: false,
            overridePrice: null,
            overrideReplayPrice: null,
            basePrice: 100,
            baseReplayPrice: 50,
          },
          changedDevices: [],
          fleetChanged: false,
          targetVerified: false,
        },
      },
      { status: 502 },
    )
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
      <DevicesScreen />
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
const setInputValue = async (element: HTMLInputElement, value: string) => {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new w.Event("input", { bubbles: true }))
  })
}

try {
  await render()
  await until(() => !!button("Game pricing"))
  await React.act(async () => button("Game pricing")!.click())
  await until(() => !!document.querySelector("#pricing-device"))
  await setValue("#pricing-device", DEVICE_ID)
  await until(() => !!document.querySelector(`button[aria-label="Change ${GAME_ID} price on ${DEVICE_ID}"]`))
  await React.act(async () =>
    (document.querySelector(`button[aria-label="Change ${GAME_ID} price on ${DEVICE_ID}"]`) as HTMLButtonElement).click(),
  )
  await until(() => !!document.querySelector('[role="dialog"]'))

  const numberInputs = () => document.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="number"]')
  await setInputValue(numberInputs()[0]!, "150")
  await setInputValue(numberInputs()[1]!, "60")

  // Default action: a device-scoped write. The mocked upstream does not confirm it, so the
  // clear "not confirmed" report must surface and point at the explicit fleet-wide action.
  const saveButton = button("Save device price")
  assert.ok(saveButton, "the default device save action must be offered")
  await React.act(async () => saveButton.click())
  await until(() => !!document.querySelector('[role="alert"]'))
  const alertText = document.querySelector('[role="alert"]')!.textContent ?? ""
  assert.ok(alertText.includes("did not confirm the requested device prices"), "the failure is reported clearly")
  assert.ok(alertText.includes("Apply to all kiosks"), "the failure points at the explicit fleet-wide action")
  assert.equal(posts.length, 1, "the default action is the only request so far")
  assert.deepEqual(posts[0], {
    path: `/api/devices/${DEVICE_ID}/games/${encodeURIComponent(GAME_ID)}/price`,
    price: 150,
    replay_price: 60,
    scope: "DEVICE",
  })
  assert.equal(posts.filter((post) => post.scope === "GAME_CATALOG").length, 0, "no automatic fallback to the catalog")

  // The fleet-wide action is separate and requires its own confirmation step.
  const openCatalog = button("Apply to all kiosks")
  assert.ok(openCatalog, "the explicit fleet-wide action must be offered")
  await React.act(async () => openCatalog.click())
  await until(() => !!document.querySelector('[role="alertdialog"]'))
  assert.equal(posts.length, 1, "opening the confirmation must not send the catalog write")
  const confirmText = document.querySelector('[role="alertdialog"]')!.textContent ?? ""
  assert.ok(confirmText.includes("cannot be limited to"), "the confirmation states the reach")
  const confirmButton = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(
    (item) => item.textContent?.trim() === "Apply to all kiosks",
  )
  assert.ok(confirmButton, "the confirmation offers the explicit apply action")
  await React.act(async () => confirmButton.click())
  await until(() => posts.some((post) => post.scope === "GAME_CATALOG"))
  await until(() => !document.querySelector('[role="dialog"]'))
  assert.equal(posts.length, 2, "exactly the confirmed catalog write was sent")
  assert.deepEqual(posts[1], {
    path: `/api/devices/${DEVICE_ID}/games/${encodeURIComponent(GAME_ID)}/price`,
    price: 150,
    replay_price: 60,
    scope: "GAME_CATALOG",
  })
  console.log("PASS devices UI: device-only default, no automatic catalog fallback, explicit confirmed fleet-wide action")
} finally {
  await React.act(async () => root.unmount())
  queryClient.clear()
  dom.window.close()
}
process.exit(0)
