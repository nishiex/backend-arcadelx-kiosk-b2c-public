import { ApiError } from '../../utils/ApiError';
import {
  GatewaysResponseSchema,
} from '@shared-types/validationSchemas/Gateways/gateway.validation';
import type {
  DeleteGatewayInput,
  Gateway,
  ReorderGatewaysInput,
  ToggleGatewayInput,
  UpsertGatewayInput,
} from '@shared-types/validationSchemas/Gateways/gateway.validation';

/**
 * Client for Mothership's payment-gateway admin API.
 *
 * Mothership owns gateway routing; this API does not store gateway state, it only
 * proxies so the dashboard can manage it behind our own role checks. Nothing here is
 * cached: these mutate live payment routing, so every read reflects Mothership.
 *
 * Notes established by probing the live host (2026-10-12; the probes that matter here
 * were read-only GET/OPTIONS):
 *   - `GET  /api/v1/admin/gateways`         answers 200 WITHOUT credentials, which is
 *     why every route that exposes it is gated by our own auth.
 *   - `POST /api/v1/admin/gateways`         create or update one provider
 *   - `POST /api/v1/admin/gateways/reorder` set priority order
 *   - `POST /api/v1/admin/gateways/toggle`  enable/disable one provider
 *   - `DELETE /api/v1/admin/gateways`       remove one provider override
 *
 * Known open issue (2026-10-12): `/reorder` is forwarded as `{ order: [...] }` and
 * returns upstream HTTP 500 (we surface 502). The same body posted directly to
 * Mothership answers 200, so the real contract is not yet established. The forwarded
 * shape was deliberately left unchanged: guessing further would mean more writes to a
 * live payment endpoint. The error body is now surfaced so the cause can be read from
 * the response instead of being a bare failure.
 */

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Upstream bodies are surfaced for diagnosis, but bounded: an HTML error page from a
 * proxy can be kilobytes, and echoing it whole helps nobody.
 */
const UPSTREAM_BODY_LIMIT = 1200;

function tidyBody(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > UPSTREAM_BODY_LIMIT
    ? `${collapsed.slice(0, UPSTREAM_BODY_LIMIT)}… (truncated)`
    : collapsed;
}

/**
 * Base admin URL, derived from the configured Mothership origin.
 *
 * Read from `process.env` rather than the validated `env` object, matching how the
 * existing Mothership syncs read their own source URLs
 * (`deviceSync.service.ts`, `revenueTransaction.services.ts`).
 */
function adminBaseUrl(): string {
  const explicit = process.env.MOTHERSHIP_ADMIN_API_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  // `MOTHERSHIP_TRANSACTION_URL` (no `_API_`) is accepted as a fallback because a live
  // deployment config uses that spelling. Without it the origin cannot be resolved and
  // every gateway route answers 503, which is exactly what happened. The documented name
  // still wins, so fixing the environment remains the preferred fix.
  const source =
    process.env.MOTHERSHIP_TRANSACTION_API_URL ??
    process.env.MOTHERSHIP_DEVICE_API_URL ??
    process.env.MOTHERSHIP_TRANSACTION_URL;
  if (!source) {
    throw new ApiError(503, 'Mothership admin API is not configured');
  }
  // The configured sources are full resource URLs on the shared origin
  // (e.g. https://host/api/v1/payments), so the origin is what we need.
  return new URL(source).origin;
}

/**
 * One place where an outbound call is made, so timeouts, error translation and
 * credential handling stay consistent.
 */
async function callMothership(
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  const url = `${adminBaseUrl()}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  // Sent only when configured. Kept in the ignored .env; never logged.
  const adminKey = process.env.MOTHERSHIP_ADMIN_API_KEY;
  if (adminKey) {
    headers['X-Admin-Api-Key'] = adminKey;
  }

  let response: Response;
  try {
    // Build the init object without an explicit `undefined` body: with
    // exactOptionalPropertyTypes, `body: undefined` is not assignable to BodyInit.
    const init2: RequestInit = {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (init.body !== undefined) init2.body = JSON.stringify(init.body);

    response = await fetch(url, init2);
  } catch (error) {
    // Network failure, DNS problem or timeout: the gateway state is unknown, so this
    // must not look like "nothing happened".
    throw new ApiError(
      502,
      `Mothership admin API unreachable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  let payload: unknown = null;
  let parsedAsJson = false;
  if (text) {
    try {
      payload = JSON.parse(text);
      parsedAsJson = true;
    } catch {
      // Keep the raw text: on a failure this is the only description of what went
      // wrong upstream, and on a success it is still worth surfacing rather than
      // silently reporting "unexpected payload".
      payload = null;
    }
  }

  if (!response.ok) {
    const body = tidyBody(text);
    // Server-side trace with the request context. No request headers are logged, so
    // the optional admin key cannot leak into logs.
    console.error('[mothership-admin] upstream rejected request', {
      method: init.method,
      path,
      upstreamStatus: response.status,
      upstreamContentType: contentType || '(none)',
      upstreamBody: body || '(empty body)',
    });
    throw new ApiError(
      response.status >= 500 ? 502 : 400,
      `Mothership admin API rejected the request (HTTP ${response.status})`,
      {
        upstreamStatus: response.status,
        upstreamContentType: contentType || null,
        // This is the point of the change: without it an upstream 500 reached the
        // caller as `errors: null`, which is not diagnosable from the client side.
        upstreamBody: body || null,
      },
    );
  }

  if (!parsedAsJson && text) {
    throw new ApiError(502, 'Mothership admin API returned a non-JSON response', {
      upstreamStatus: response.status,
      upstreamContentType: contentType || null,
      upstreamBody: tidyBody(text),
    });
  }

  return payload;
}

export async function listGateways(): Promise<{ total: number; gateways: Gateway[] }> {
  const payload = await callMothership('/api/v1/admin/gateways', { method: 'GET' });
  const parsed = GatewaysResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, 'Mothership admin API returned an unexpected gateways payload');
  }
  return { total: parsed.data.total, gateways: parsed.data.gateways };
}

export async function upsertGateway(input: UpsertGatewayInput): Promise<unknown> {
  return callMothership('/api/v1/admin/gateways', { method: 'POST', body: input });
}

export async function reorderGateways(input: ReorderGatewaysInput): Promise<unknown> {
  return callMothership('/api/v1/admin/gateways/reorder', { method: 'POST', body: input });
}

export async function toggleGateway(input: ToggleGatewayInput): Promise<unknown> {
  return callMothership('/api/v1/admin/gateways/toggle', { method: 'POST', body: input });
}

export async function deleteGateway(input: DeleteGatewayInput): Promise<unknown> {
  return callMothership('/api/v1/admin/gateways', { method: 'DELETE', body: input });
}
