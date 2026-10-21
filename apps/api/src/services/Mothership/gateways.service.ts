import { ApiError } from '../../utils/ApiError';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../utils/db';
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
 * Mothership owns gateway routing; this API proxies it so the dashboard can manage
 * it behind our own role checks. The only local state is the development fallback
 * marker used when the upstream removal endpoint answers 405.
 *
 * Notes established by probing the live host (2026-10-12; the probes that matter here
 * were read-only GET/OPTIONS):
 *   - `GET  /api/v1/admin/gateways`         answers 200 WITHOUT credentials, which is
 *     why every route that exposes it is gated by our own auth.
 *   - `POST /api/v1/admin/gateways`         create or update one provider. This one does
 *     store `priority`, so reordering is built on it.
 *   - `POST /api/v1/admin/gateways/reorder` **not implemented upstream** -- it answers
 *     HTTP 200 `{ status: "success", message: "Priorities updated." }` for *any* body,
 *     unparseable input included, and stores nothing (probed 2026-10-13, re-verified
 *     live 2026-10-14). It is deliberately unused by this client.
 *   - `POST /api/v1/admin/gateways/toggle`  enable/disable one provider
 *   - `DELETE /api/v1/admin/gateways/<provider>` remove one provider override
 *
 * Because `/reorder` is a no-op, `reorderGateways` below sets the order through
 * per-provider upserts and then reads the gateway list back, rejecting and logging a
 * mismatch instead of reporting a false success. The live mutation is never retried
 * automatically, and a failure part-way through reports what was already applied.
 * Live evidence for all of this: audits/gateways/README.md.
 */

const REQUEST_TIMEOUT_MS = 15000;

// Local-only compatibility state. The current Mothership deployment rejects the
// collection DELETE with 405, so a successful fallback removal must not immediately
// reappear when the dashboard refetches the gateway list or when the local API restarts.
const locallyRemovedProviders = new Set<string>();
const localRemovedProvidersFile = path.resolve(
  process.cwd(),
  'tmp/mothership-removed-gateways.json',
);
let localRemovedProvidersLoaded: Promise<void> | undefined;

async function loadLocalRemovedProviders(): Promise<void> {
  if (!localRemovedProvidersLoaded) {
    localRemovedProvidersLoaded = fs
      .readFile(localRemovedProvidersFile, 'utf8')
      .then((contents) => {
        const providers: unknown = JSON.parse(contents);
        if (Array.isArray(providers)) {
          for (const provider of providers) {
            if (typeof provider === 'string' && provider.length > 0) {
              locallyRemovedProviders.add(provider);
            }
          }
        }
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          console.warn('[mothership-admin] could not load local gateway removals', {
            error: error.message,
          });
        }
      });
  }
  await localRemovedProvidersLoaded;
}

async function saveLocalRemovedProviders(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(localRemovedProvidersFile), { recursive: true });
    await fs.writeFile(
      localRemovedProvidersFile,
      `${JSON.stringify([...locallyRemovedProviders].sort(), null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    // Vercel's serverless filesystem is not persistent and may not allow writes
    // under /var/task. The in-memory marker still prevents the gateway from
    // reappearing during this warm invocation; persistence is best-effort for
    // local development only and must never turn a successful fallback removal
    // into a 500 response.
    console.warn('[mothership-admin] could not persist local gateway removals', {
      file: localRemovedProvidersFile,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function getRemovedProviders(): Promise<Set<string>> {
  const removed = await prisma.removedGateway.findMany({
    select: { provider: true },
  });
  return new Set([
    ...removed.map(({ provider }) => provider),
    ...locallyRemovedProviders,
  ]);
}

async function markGatewayRemoved(provider: string): Promise<void> {
  await prisma.removedGateway.upsert({
    where: { provider },
    create: { provider },
    update: {},
  });
  locallyRemovedProviders.add(provider);
  await saveLocalRemovedProviders();
}

async function unmarkGatewayRemoved(provider: string): Promise<void> {
  await prisma.removedGateway.deleteMany({ where: { provider } });
  locallyRemovedProviders.delete(provider);
  await saveLocalRemovedProviders();
}

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
  if (explicit) return new URL(explicit).origin;
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
  // Configured sources may be full resource URLs (including the reorder endpoint),
  // but the routes below are absolute Mothership API paths.
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
  await loadLocalRemovedProviders();
  const removedProviders = await getRemovedProviders();
  const payload = await callMothership('/api/v1/admin/gateways', { method: 'GET' });
  const parsed = GatewaysResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(502, 'Mothership admin API returned an unexpected gateways payload');
  }
  const gateways = parsed.data.gateways.filter(
    (gateway) => gateway.is_active && !removedProviders.has(gateway.provider),
  );
  return { total: gateways.length, gateways };
}

export async function upsertGateway(input: UpsertGatewayInput): Promise<unknown> {
  await loadLocalRemovedProviders();
  const result = await callMothership('/api/v1/admin/gateways', { method: 'POST', body: input });
  await unmarkGatewayRemoved(input.provider);
  return result;
}

/** Relative routing order: the providers sorted by priority, lowest first. */
function orderedProviders(gateways: Gateway[]): string[] {
  return [...gateways].sort((a, b) => a.priority - b.priority).map((gateway) => gateway.provider);
}

/**
 * Set the routing priority order.
 *
 * Mothership has no working reorder endpoint (see the header note), so the order is applied
 * one provider at a time through `POST /api/v1/admin/gateways` -- the same call the provider
 * form makes -- and then verified by reading the list back. Two properties matter:
 *
 *   - Writes go in **ascending target priority**, so the provider that should end up first
 *     is written first and a provider at priority 1 exists throughout. Writing the demoted
 *     provider first would briefly leave no provider at priority 1 at all.
 *   - A provider already at its target priority is **not written at all**, so an order that
 *     is already in place costs no live write.
 *
 * The sequence is not atomic: between two writes the list can hold a duplicate priority (a
 * tie), which is why the end state is verified and a partial failure is reported as such.
 */
export async function reorderGateways(input: ReorderGatewaysInput): Promise<unknown> {
  const requestedOrder = [...input.gateways]
    .sort((a, b) => a.priority - b.priority)
    .map((gateway) => gateway.provider);

  // The current list is both the starting point and the set of providers a reorder may name:
  // priorities are relative, so a request that invents or omits a provider cannot be honored.
  const current = await listGateways();
  const currentByProvider = new Map(current.gateways.map((gateway) => [gateway.provider, gateway]));
  const currentOrder = orderedProviders(current.gateways);

  const unknownProviders = requestedOrder.filter((provider) => !currentByProvider.has(provider));
  const missingProviders = currentOrder.filter((provider) => !requestedOrder.includes(provider));
  if (unknownProviders.length > 0 || missingProviders.length > 0) {
    throw new ApiError(400, 'Reorder must name exactly the configured gateways', {
      unknownProviders,
      missingProviders,
      configuredProviders: currentOrder,
    });
  }

  // Sequential writes are not atomic, so order them (which puts priority 1 first) and skip
  // every provider that already holds its target priority.
  const writes = requestedOrder
    .map((provider, index) => ({ provider, priority: index + 1 }))
    .filter(({ provider, priority }) => currentByProvider.get(provider)?.priority !== priority);

  const appliedWrites: Array<{ provider: string; priority: number }> = [];
  for (const write of writes) {
    try {
      await upsertGateway(write);
      appliedWrites.push(write);
    } catch (error) {
      // Part-way through, the live order already holds some of the new priorities. Saying so
      // -- and reporting the order actually in force -- beats implying nothing happened.
      const liveOrder = await listGateways()
        .then((list) => orderedProviders(list.gateways))
        .catch(() => null);
      console.error('[mothership-admin] gateway reorder failed part-way', {
        requestedOrder,
        appliedWrites,
        failedWrite: write,
        liveOrder,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ApiError(
        502,
        'Mothership failed during the priority update; some priorities may already be applied',
        { requestedOrder, appliedWrites, failedWrite: write, liveOrder },
      );
    }
  }

  // Verify the change by reading the live list back and comparing the *relative routing
  // order* (which provider is first, second, etc.). Mothership may normalise the exact
  // priority numbers it stores, so comparing numeric values would mismatch even after a
  // successful write; relative order is all that payment routing uses.
  let after: { gateways: Gateway[] };
  try {
    after = await listGateways();
  } catch (error) {
    console.error('[mothership-admin] could not verify gateway reorder', {
      requestedOrder,
      appliedWrites,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ApiError(
      502,
      'The gateway priority order was written, but the result could not be verified',
      {
        requestedOrder,
        appliedWrites,
        verificationError: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const liveOrder = orderedProviders(after.gateways);
  const orderMismatch =
    requestedOrder.length !== liveOrder.length ||
    requestedOrder.some((provider, index) => provider !== liveOrder[index]);

  if (orderMismatch) {
    console.error('[mothership-admin] gateway reorder was not applied', {
      requestedOrder,
      liveOrder,
      appliedWrites,
    });
    throw new ApiError(
      502,
      'Mothership did not apply the requested gateway priority order',
      { requestedOrder, liveOrder, appliedWrites },
    );
  }

  return {
    status: 'success',
    message: 'Priorities updated.',
    requestedOrder,
    appliedWrites,
    liveOrder,
  };
}

export async function toggleGateway(input: ToggleGatewayInput): Promise<unknown> {
  return callMothership('/api/v1/admin/gateways/toggle', { method: 'POST', body: input });
}

export async function deleteGateway(input: DeleteGatewayInput): Promise<unknown> {
  await loadLocalRemovedProviders();
  const providerPath = `/api/v1/admin/gateways/${encodeURIComponent(input.provider)}`;
  try {
    // Mothership supports deletion on the provider-specific route. The collection
    // DELETE route advertises a different contract and returns 405, so do not send
    // the provider in a collection body as the primary removal attempt.
    const result = await callMothership(providerPath, { method: 'DELETE' });
    await markGatewayRemoved(input.provider);
    return result;
  } catch (error) {
    // Keep the dashboard usable if a deployment does not expose the provider
    // route: disabling is still safer than reporting a successful removal that
    // did not happen upstream.
    const upstreamStatus =
      error instanceof ApiError &&
      typeof error.errors === 'object' &&
      error.errors !== null &&
      'upstreamStatus' in error.errors
        ? error.errors.upstreamStatus
        : undefined;
    if (upstreamStatus !== 405) throw error;

    console.warn('[mothership-admin] provider DELETE is unavailable; disabling gateway instead', {
      provider: input.provider,
    });
    const fallback = await toggleGateway({ provider: input.provider, is_active: false });
    await markGatewayRemoved(input.provider);
    return { fallback: 'disable', provider: input.provider, result: fallback };
  }
}
