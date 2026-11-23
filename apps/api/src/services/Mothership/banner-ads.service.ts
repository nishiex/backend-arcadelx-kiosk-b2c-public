import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';

const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export function getMothershipOrigin(): string {
  const origin = env.MOTHERSHIP_API_URL || process.env.MOTHERSHIP_API_URL || 'http://200.234.43.147:8080';
  return new URL(origin).origin;
}

async function callMothershipJson(
  path: string,
  init: { method: string; body?: unknown },
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  const origin = getMothershipOrigin();
  const url = `${origin}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: globalThis.Response;
  try {
    const fetchInit: RequestInit = {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (init.body !== undefined) {
      fetchInit.body = JSON.stringify(init.body);
    }
    response = await fetch(url, fetchInit);
  } catch (error) {
    throw new ApiError(
      502,
      `Mothership unreachable: ${error instanceof Error ? error.message : 'network request failed'}`,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    let msg = `Mothership rejected request (HTTP ${response.status})`;
    if (payload && typeof payload === 'object' && ('error' in payload || 'message' in payload || 'detail' in payload)) {
      const rec = payload as Record<string, unknown>;
      const cand = rec.error || rec.message || rec.detail;
      if (typeof cand === 'string' && cand.trim()) msg = cand.trim();
    }
    throw new ApiError(response.status >= 500 ? 502 : response.status, msg, payload);
  }

  return { status: response.status, body: payload };
}

export async function fetchBannerAdsConfigFromMothership(): Promise<unknown> {
  const res = await callMothershipJson('/api/v1/banner-ads/config', { method: 'GET' });
  return res.body;
}

export async function fetchBannerAdsListFromMothership(): Promise<unknown> {
  const res = await callMothershipJson('/api/v1/banner-ads', { method: 'GET' });
  return res.body;
}

export async function createBannerAdOnMothership(payload: unknown): Promise<unknown> {
  const res = await callMothershipJson('/api/v1/banner-ads', {
    method: 'POST',
    body: payload,
  });
  return res.body;
}

export async function updateBannerAdOnMothership(id: string | number, payload: unknown): Promise<unknown> {
  const res = await callMothershipJson(`/api/v1/banner-ads/${encodeURIComponent(id)}/update`, {
    method: 'POST',
    body: payload,
  });
  return res.body;
}

export async function deleteBannerAdOnMothership(id: string | number): Promise<unknown> {
  const res = await callMothershipJson(`/api/v1/banner-ads/${encodeURIComponent(id)}/delete`, {
    method: 'POST',
  });
  return res.body;
}

export function streamUploadChunk(req: Request, res: Response): void {
  const origin = getMothershipOrigin();
  const targetUrl = new URL(`${origin}/api/v1/banner-ads/upload-chunk`);
  const isHttps = targetUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const headers: http.OutgoingHttpHeaders = {};
  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'];
  }
  if (req.headers['content-length']) {
    headers['content-length'] = req.headers['content-length'];
  }

  const proxyReq = client.request(
    targetUrl,
    {
      method: 'POST',
      headers,
      timeout: UPLOAD_TIMEOUT_MS,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 200);
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        if (val !== undefined) {
          res.setHeader(key, val);
        }
      }
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Mothership upload chunk timed out'));
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        status: 'error',
        message: `Mothership chunk upload failed: ${err.message}`,
      });
    }
  });

  req.pipe(proxyReq);
}

export function streamBannerAdFile(filename: string, req: Request, res: Response): void {
  const origin = getMothershipOrigin();
  const targetUrl = new URL(`${origin}/api/v1/banner-ads/files/${encodeURIComponent(filename)}`);
  const isHttps = targetUrl.protocol === 'https:';
  const client = isHttps ? https : http;

  const headers: http.OutgoingHttpHeaders = {};
  if (req.headers['range']) {
    headers['range'] = req.headers['range'];
  }

  const proxyReq = client.request(
    targetUrl,
    {
      method: 'GET',
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 200);
      for (const [key, val] of Object.entries(proxyRes.headers)) {
        if (val !== undefined) {
          res.setHeader(key, val);
        }
      }
      proxyRes.pipe(res);
    },
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Mothership file stream timed out'));
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        status: 'error',
        message: `Mothership video streaming failed: ${err.message}`,
      });
    }
  });

  proxyReq.end();
}
