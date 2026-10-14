import assert from "node:assert/strict";
import { ApiError } from "../src/utils/ApiError";
import { reorderGateways } from "../src/services/Mothership/gateways.service";

/**
 * Mocked verification of the reorder mechanism.
 *
 * Mothership's `/reorder` never stored anything, so `reorderGateways` now sets the order
 * through per-provider upserts (`POST /api/v1/admin/gateways`) and verifies the result by
 * reading the list back. This harness simulates Mothership in memory and covers:
 *
 *   1. writes ignored -- the live defect -- must reject with 502 instead of reporting success,
 *   2. writes honoured must resolve, with the upserts sent in ascending target priority,
 *   3. an order already in place must cost no write at all,
 *   4. a request naming a provider that is not configured must be refused with 400,
 *   5. a write failing part-way must report what was already applied,
 *   6. the unused `/reorder` endpoint must never be called.
 *
 * Run: npx tsx --tsconfig apps/api/tsconfig.json apps/api/scripts/gateway-reorder-verification-check.ts
 */
type Row = {
  provider: string;
  display_name: string;
  priority: number;
  is_active: boolean;
  has_driver: boolean;
  credentials: Record<string, unknown>;
};

const row = (provider: string, priority: number): Row => ({
  provider,
  display_name: provider,
  priority,
  is_active: true,
  has_driver: true,
  credentials: {},
});

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
const originalAdminUrl = process.env.MOTHERSHIP_ADMIN_API_URL;
const capturedErrors: unknown[][] = [];
const calls: Array<{ url: string; method: string; body?: string }> = [];

// Simulated Mothership state. `honoursWrites` models the difference between the upsert
// endpoint (which stores priority) and `/reorder` (which never did).
let state: Row[] = [];
let honoursWrites = true;
let failForProvider: string | null = null;

process.env.MOTHERSHIP_ADMIN_API_URL = "https://main.arcadelx.games/api/v1/admin/gateways";
console.error = (...args: unknown[]) => capturedErrors.push(args);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : undefined;
  calls.push(body === undefined ? { url, method } : { url, method, body });

  if (method === "GET") {
    return Response.json({
      status: "success",
      total: state.length,
      gateways: [...state].sort((a, b) => a.priority - b.priority),
    });
  }

  const payload = JSON.parse(body ?? "{}") as { provider: string; priority?: number };
  if (payload.provider === failForProvider) {
    return new Response("upstream exploded", { status: 500 });
  }
  if (honoursWrites && payload.priority !== undefined) {
    state = state.map((gateway) =>
      gateway.provider === payload.provider ? { ...gateway, priority: payload.priority as number } : gateway,
    );
  }
  return Response.json({ status: "success", message: `Gateway '${payload.provider}' configured.` });
};

const reset = (initial: Row[]) => {
  state = initial;
  honoursWrites = true;
  failForProvider = null;
  calls.length = 0;
  capturedErrors.length = 0;
};

/** Desired new order, exactly what the dashboard's move-up sends: payu=1, razorpay=2. */
const requestedGateways = [
  { provider: "payu", priority: 1 },
  { provider: "razorpay", priority: 2 },
];
const oldOrder = [row("razorpay", 1), row("payu", 2)];

const orderOf = (rows: Row[]) => [...rows].sort((a, b) => a.priority - b.priority).map((r) => r.provider);

try {
  // Case 1: Mothership ignores the priority writes (the live defect) -> reject, no false success.
  reset(oldOrder);
  honoursWrites = false;
  let ignoredError: unknown;
  try {
    await reorderGateways({ gateways: requestedGateways });
  } catch (error) {
    ignoredError = error;
  }
  assert.ok(
    ignoredError instanceof ApiError &&
      ignoredError.statusCode === 502 &&
      ignoredError.message.includes("did not apply"),
    "a silently ignored write must not be reported as success",
  );
  assert.deepEqual((ignoredError as ApiError).errors, {
    requestedOrder: ["payu", "razorpay"],
    liveOrder: ["razorpay", "payu"],
    appliedWrites: requestedGateways,
  });
  assert.deepEqual(
    calls.map((call) => `${call.method} ${call.url.replace("https://main.arcadelx.games", "")}${call.body ? " " + call.body : ""}`),
    [
      'GET /api/v1/admin/gateways',
      'POST /api/v1/admin/gateways {"provider":"payu","priority":1}',
      'POST /api/v1/admin/gateways {"provider":"razorpay","priority":2}',
      "GET /api/v1/admin/gateways",
    ],
    "ascending target priority: the provider that should be first is written first",
  );
  assert.equal(capturedErrors.length, 1);
  assert.equal(
    (capturedErrors[0]?.[0] as string).includes("gateway reorder was not applied"),
    true,
  );

  // Case 2: the writes are honoured -> resolves, and the live state really changed.
  reset(oldOrder);
  const result = (await reorderGateways({ gateways: requestedGateways })) as {
    appliedWrites: unknown[];
    liveOrder: string[];
  };
  assert.deepEqual(orderOf(state), ["payu", "razorpay"]);
  assert.deepEqual(result.appliedWrites, requestedGateways);
  assert.deepEqual(result.liveOrder, ["payu", "razorpay"]);
  assert.equal(capturedErrors.length, 0);

  // Case 3: already in the requested order -> no write is sent at all.
  reset([row("payu", 1), row("razorpay", 2)]);
  await reorderGateways({ gateways: requestedGateways });
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET"],
    "an order that is already in place must not touch live routing",
  );
  assert.equal(capturedErrors.length, 0);

  // Case 4: a provider that is not configured cannot be reordered -> 400, and nothing is written.
  reset(oldOrder);
  await assert.rejects(
    reorderGateways({ gateways: [{ provider: "stripe", priority: 1 }, { provider: "razorpay", priority: 2 }] }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.statusCode === 400 &&
      error.message.includes("exactly the configured gateways"),
  );
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET"],
    "a rejected reorder must not write anything",
  );

  // Case 5: a write fails part-way -> 502 that says what was already applied.
  reset(oldOrder);
  failForProvider = "razorpay";
  let partialError: unknown;
  try {
    await reorderGateways({ gateways: requestedGateways });
  } catch (error) {
    partialError = error;
  }
  assert.ok(
    partialError instanceof ApiError &&
      partialError.statusCode === 502 &&
      partialError.message.includes("some priorities may already be applied"),
    "a partial write must be reported as an explicit 502",
  );
  assert.deepEqual((partialError as ApiError).errors, {
    requestedOrder: ["payu", "razorpay"],
    appliedWrites: [{ provider: "payu", priority: 1 }],
    failedWrite: { provider: "razorpay", priority: 2 },
    liveOrder: ["razorpay", "payu"],
  });
  assert.equal(state.find((g) => g.provider === "payu")?.priority, 1, "the first write did land");
  assert.equal(
    state.find((g) => g.provider === "razorpay")?.priority,
    1,
    "the failed write left razorpay as it was",
  );

  // Case 6: nothing may call Mothership's no-op reorder endpoint.
  assert.equal(
    calls.some((call) => call.url.endsWith("/gateways/reorder")) ||
      capturedErrors.some((args) => JSON.stringify(args).includes("/gateways/reorder")),
    false,
    "the unused upstream /reorder endpoint must never be called",
  );

  console.log(
    "PASS reorder applies the order through per-provider upserts (ascending target priority), skips no-op writes, verifies the read-back, and rejects 502/400 instead of reporting a false success",
  );
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  if (originalAdminUrl === undefined) {
    delete process.env.MOTHERSHIP_ADMIN_API_URL;
  } else {
    process.env.MOTHERSHIP_ADMIN_API_URL = originalAdminUrl;
  }
}
