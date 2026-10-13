import assert from "node:assert/strict";
import { ApiError } from "../src/utils/ApiError";
import { reorderGateways } from "../src/services/Mothership/gateways.service";

const gateway = (provider: string, priority: number) => ({
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
let listResponse: unknown;

// Confirmed Mothership contract (probed 2026-10-13):
//   POST /api/v1/admin/gateways/reorder body: { gateways: [{ provider, priority }] }
process.env.MOTHERSHIP_ADMIN_API_URL =
  "https://main.arcadelx.games/api/v1/admin/gateways/reorder";
console.error = (...args: unknown[]) => capturedErrors.push(args);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : undefined;
  calls.push(body === undefined ? { url, method } : { url, method, body });
  if (method === "POST") {
    return Response.json({ status: "success", message: "Priorities updated." });
  }
  return Response.json(listResponse);
};

// Desired new order: payu=1, razorpay=2
const requestedGateways = [
  { provider: "payu", priority: 1 },
  { provider: "razorpay", priority: 2 },
];

try {
  // Case 1: Mothership returns the OLD order — reorder did not apply → should reject.
  listResponse = {
    status: "success",
    total: 2,
    gateways: [gateway("razorpay", 1), gateway("payu", 2)],
  };
  await assert.rejects(
    reorderGateways({ gateways: requestedGateways }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.statusCode === 502 &&
      error.message.includes("did not apply"),
  );
  assert.deepEqual(calls.slice(0, 2), [
    {
      url: "https://main.arcadelx.games/api/v1/admin/gateways/reorder",
      method: "POST",
      body: JSON.stringify({ gateways: requestedGateways }),
    },
    {
      url: "https://main.arcadelx.games/api/v1/admin/gateways",
      method: "GET",
    },
  ]);
  assert.equal(capturedErrors.length, 1);
  assert.equal(
    (capturedErrors[0]?.[0] as string).includes("gateway reorder was not applied"),
    true,
  );

  // Case 2: Mothership returns the NEW order — success.
  calls.length = 0;
  capturedErrors.length = 0;
  listResponse = {
    status: "success",
    total: 2,
    gateways: [gateway("payu", 1), gateway("razorpay", 2)],
  };
  await reorderGateways({ gateways: requestedGateways });
  assert.equal(calls.length, 2);
  assert.equal(capturedErrors.length, 0);

  console.log(
    "PASS reorder uses { gateways: [{provider,priority}] } body, verifies read-back order, and logs/rejects a stale no-op",
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
