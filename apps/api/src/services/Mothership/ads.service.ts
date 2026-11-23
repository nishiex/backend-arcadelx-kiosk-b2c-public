import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

function getOrigin(): string {
  return new URL(env.MOTHERSHIP_API_URL || 'http://200.234.43.147:8080').origin;
}

async function callJson(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
  let response: globalThis.Response;
  try {
    const fetchInit: RequestInit = {
      method: init.method,
      headers: { Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (init.body !== undefined) fetchInit.body = JSON.stringify(init.body);
    response = await fetch(`${getOrigin()}${path}`, fetchInit);
  } catch (error) {
    throw new ApiError(502, `Mothership unreachable: ${error instanceof Error ? error.message : 'network request failed'}`);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }
  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const message = [record.error, record.message, record.detail].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?? `Mothership rejected request (HTTP ${response.status})`;
    throw new ApiError(response.status >= 500 ? 502 : response.status, message, payload);
  }
  return payload;
}

export const fetchAdsConfigFromMothership = () => callJson('/api/v1/ads/config', { method: 'GET' });
export const fetchAdsListFromMothership = () => callJson('/api/v1/ads', { method: 'GET' });
export const createAdOnMothership = (payload: unknown) => callJson('/api/v1/ads', { method: 'POST', body: payload });
export const updateAdOnMothership = (id: string, payload: unknown) => callJson(`/api/v1/ads/${encodeURIComponent(id)}/update`, { method: 'POST', body: payload });
export const assignAdOnMothership = (id: string, payload: unknown) => callJson(`/api/v1/ads/${encodeURIComponent(id)}/assign`, { method: 'POST', body: payload });
export const deleteAdOnMothership = (id: string) => callJson(`/api/v1/ads/${encodeURIComponent(id)}/delete`, { method: 'POST' });

export function streamAdUploadChunk(req: Request, res: Response): void {
  proxyStream(`${getOrigin()}/api/v1/ads/upload-chunk`, 'POST', req, res, true);
}

export function streamAdFile(filename: string, req: Request, res: Response): void {
  proxyStream(`${getOrigin()}/api/v1/ads/files/${encodeURIComponent(filename)}`, 'GET', req, res, false);
}

function proxyStream(target: string, method: string, req: Request, res: Response, upload: boolean): void {
  const targetUrl = new URL(target);
  const client = targetUrl.protocol === 'https:' ? https : http;
  const headers: http.OutgoingHttpHeaders = {};
  if (upload && req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (upload && req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
  if (!upload && req.headers.range) headers.range = req.headers.range;

  const proxyReq = client.request(targetUrl, { method, headers, timeout: upload ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS }, (proxyRes) => {
    res.status(proxyRes.statusCode || 200);
    for (const [key, value] of Object.entries(proxyRes.headers)) if (value !== undefined) res.setHeader(key, value);
    proxyRes.pipe(res);
  });
  proxyReq.on('timeout', () => proxyReq.destroy(new Error('Mothership Ads request timed out')));
  proxyReq.on('error', (error) => {
    if (!res.headersSent) res.status(502).json({ status: 'error', message: `Mothership Ads request failed: ${error.message}` });
  });
  if (upload) req.pipe(proxyReq); else proxyReq.end();
}
