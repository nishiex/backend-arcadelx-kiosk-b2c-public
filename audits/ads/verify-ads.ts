/**
 * End-to-end verification for the ads module against a scratch local database.
 *
 * Proves, through the real Express app and real HTTP:
 *   - resumable, out-of-order, idempotent chunk upload and the configured limits
 *   - server-authoritative metadata (size/mime/filename from the upload session)
 *   - organization scoping on reads, writes, playback and kiosk assignment
 *   - retired-kiosk rejection and range-aware video playback
 *   - row + file deletion, and no orphaned file after a failed create
 *
 * Run from the repository root (scratch DB `arcadelx_ads_verify` on arcadelx-pg:5433):
 *   npx tsx --tsconfig apps/api/tsconfig.json audits/ads/verify-ads.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

// Must be set before the app (and its validated env module) is imported.
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = 'postgresql://postgres:devpass@localhost:5433/arcadelx_ads_verify';
process.env.DIRECT_URL = process.env.DATABASE_URL;
const UPLOAD_ROOT = path.join(os.tmpdir(), `arcadelx-ads-verify-${Date.now()}`);
process.env.ADS_UPLOAD_DIR = UPLOAD_ROOT;
process.env.ADS_MAX_VIDEO_SIZE = String(1024 * 1024); // 1 MB
process.env.ADS_MAX_CHUNK_SIZE = String(256 * 1024); // 256 KB

const BASE = 'http://127.0.0.1:4010';
const SEEDED_EMAIL = 'ads-verify@example.test';
const SEEDED_PASSWORD = 'AdsVerify@123';

type Check = { name: string; ok: boolean; detail?: unknown };
const checks: Check[] = [];
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ` :: ${JSON.stringify(detail)}`}`);
  if (!ok) failures.push(name);
}

function cookiesFrom(response: Response): string {
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

async function login(email: string, password: string) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => null)) as any;
  return { response, body, cookie: cookiesFrom(response) };
}

function api(pathname: string, init: RequestInit, cookie?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  return fetch(`${BASE}${pathname}`, { ...init, headers });
}

async function json(response: Response): Promise<any> {
  return response.json().catch(() => null);
}

type ChunkOrder = 'sequential' | 'reverse' | 'out-of-order';

async function uploadVideo(
  cookie: string,
  options: {
    totalSize?: number;
    filename?: string;
    mimeType?: string;
    order?: ChunkOrder;
  } = {},
) {
  const totalSize = options.totalSize ?? 700_000;
  const filename = options.filename ?? 'clip.mp4';
  const mimeType = options.mimeType ?? 'video/mp4';

  const init = await api(
    '/api/ads/uploads',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ originalFilename: filename, mimeType, totalSize }),
    },
    cookie,
  );
  const initBody = await json(init);

  const bytes = crypto.randomBytes(totalSize);
  const chunkSize: number = initBody?.data?.chunkSize ?? 0;
  const totalChunks: number = initBody?.data?.totalChunks ?? 0;
  const uploadId: string | undefined = initBody?.data?.uploadId;

  if (init.status !== 201 || !uploadId || !chunkSize) {
    return { init, initBody, uploadId, bytes, chunkSize, totalChunks, chunkResults: [] as number[] };
  }

  const indices = Array.from({ length: totalChunks }, (_, index) => index);
  const order =
    options.order === 'reverse'
      ? [...indices].reverse()
      : options.order === 'out-of-order' && indices.length >= 3
        ? [2, 0, 1, ...indices.slice(3)]
        : indices;

  const chunkResults: number[] = [];
  for (const index of order) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const chunk = bytes.subarray(start, end);
    const response = await api(
      `/api/ads/uploads/${uploadId}/chunks/${index}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(chunk),
      },
      cookie,
    );
    chunkResults.push(response.status);
  }

  return { init, initBody, uploadId, bytes, chunkSize, totalChunks, chunkResults };
}

async function main(): Promise<void> {
  fs.mkdirSync(path.join(UPLOAD_ROOT), { recursive: true });

  const { default: app } = await import('../../apps/api/src/app');
  const { prisma } = await import('../../apps/api/src/utils/db');
  const bcrypt = (await import('bcryptjs')).default;
  const adsService = await import('../../apps/api/src/services/ads.service');
  const { attachLibraryAds } = await import('../../apps/api/src/services/Mothership/devices.service');

  const server = app.listen(4010, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const suffix = Date.now();
  // A fixed contact made an interrupted run block every later one on User_contact_key.
  // 9 + 8 digits + slot keeps it a unique ten-digit value per run.
  const contactBase = `9${String(suffix).slice(-8).padStart(8, '0')}`;
  const contactFor = (slot: number) => `${contactBase}${slot}`;
  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];
  const createdKioskIds: string[] = [];
  const createdAdIds: string[] = [];

  try {
    // ── Fixtures ────────────────────────────────────────────────────────────────
    const seeded = await prisma.user.findUnique({
      where: { email: SEEDED_EMAIL },
      include: { membership: true },
    });
    if (!seeded?.membership) throw new Error('Seed owner/membership missing from scratch DB');
    const companyA = seeded.membership.organizationId;

    async function makeCompany(
      label: string,
      type: 'COMPANY' | 'DISTRIBUTOR',
      contact: string,
    ) {
      const email = `ads-${label}-${suffix}@example.test`;
      const password = 'Other@1234';
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { email, name: `${label} owner`, passwordHash, contact },
      });
      createdUserIds.push(user.id);
      const org = await prisma.organization.create({
        data: {
          ownerId: user.id,
          name: `${label}-${suffix}`,
          type,
          state: 'KA',
          city: 'Bengaluru',
          pincode: 560001,
          address: '1 Test Street',
        },
      });
      createdOrgIds.push(org.id);
      await prisma.membership.create({
        data: { userId: user.id, organizationId: org.id, role: 'OWNER', status: 'ACTIVE' },
      });
      return { email, password, orgId: org.id };
    }

    const distributor = await makeCompany('dist', 'DISTRIBUTOR', contactFor(3));

    // A second OWNER/ADMIN inside the same company: needed to prove that an upload
    // session is bound to the user who created it, not merely to the organization.
    async function makeCompanyMember(organizationId: string, role: 'ADMIN' | 'STAFF', contact: string) {
      const email = `ads-member-${role.toLowerCase()}-${suffix}@example.test`;
      const password = 'Other@1234';
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { email, name: `${role} member`, passwordHash, contact },
      });
      createdUserIds.push(user.id);
      await prisma.membership.create({
        data: { userId: user.id, organizationId, role, status: 'ACTIVE' },
      });
      return { email, password };
    }

    const adminA = await makeCompanyMember(companyA, 'ADMIN', contactFor(5));

    async function makeKiosk(orgId: string, label: string, status: 'AVAILABLE' | 'RETIRED') {
      const kiosk = await prisma.kiosk.create({
        data: {
          machineCode: `ADS-${label}-${suffix}`,
          model: 'Arcade-LX B2C',
          status,
          currentOrgId: orgId,
        },
      });
      createdKioskIds.push(kiosk.id);
      return kiosk;
    }

    const kioskA = await makeKiosk(companyA, 'A', 'AVAILABLE');
    const kioskB = await makeKiosk(distributor.orgId, 'B', 'AVAILABLE');
    const kioskRetired = await makeKiosk(companyA, 'R', 'RETIRED');

    // ── Authentication and gates ────────────────────────────────────────────────
    const anonymousList = await api('/api/ads', { method: 'GET' });
    check('anonymous list is rejected', anonymousList.status === 401, anonymousList.status);

    const ownerA = await login(SEEDED_EMAIL, SEEDED_PASSWORD);
    check('company owner can log in', ownerA.response.status === 200 && !!ownerA.cookie, ownerA.response.status);

    const adminLogin = await login(adminA.email, adminA.password);
    check('a company admin can log in', adminLogin.response.status === 200 && !!adminLogin.cookie, adminLogin.response.status);

    const distributorLogin = await login(distributor.email, distributor.password);
    check('distributor can log in', distributorLogin.response.status === 200, distributorLogin.response.status);

    const distributorList = await api('/api/ads', { method: 'GET' }, distributorLogin.cookie);
    check('distributor is refused by the COMPANY gate', distributorList.status === 403, distributorList.status);

    const config = await api('/api/ads/config', { method: 'GET' }, ownerA.cookie);
    const configBody = await json(config);
    check(
      'upload config reflects the configured limits',
      config.status === 200 &&
        configBody?.data?.maxVideoSizeBytes === 1024 * 1024 &&
        configBody?.data?.maxChunkSizeBytes === 256 * 1024,
      configBody?.data,
    );

    // ── Upload validation ───────────────────────────────────────────────────────
    const oversize = await api(
      '/api/ads/uploads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ originalFilename: 'big.mp4', mimeType: 'video/mp4', totalSize: 2 * 1024 * 1024 }),
      },
      ownerA.cookie,
    );
    check('oversized video is rejected with 413', oversize.status === 413, oversize.status);

    const wrongMime = await api(
      '/api/ads/uploads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ originalFilename: 'clip.mp4', mimeType: 'text/html', totalSize: 1000 }),
      },
      ownerA.cookie,
    );
    check('non-video MIME type is rejected', wrongMime.status === 400, wrongMime.status);

    const extensionMismatch = await api(
      '/api/ads/uploads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ originalFilename: 'clip.html', mimeType: 'video/mp4', totalSize: 1000 }),
      },
      ownerA.cookie,
    );
    check('extension/MIME mismatch is rejected as 415', extensionMismatch.status === 415, extensionMismatch.status);

    // ── Resumable upload ────────────────────────────────────────────────────────
    const upload = await uploadVideo(ownerA.cookie, { totalSize: 700_000, order: 'out-of-order' });
    check('upload starts with three chunks', upload.init.status === 201 && upload.totalChunks === 3, upload.initBody?.data);
    check(
      'out-of-order chunks are accepted',
      upload.chunkResults.length === 3 && upload.chunkResults.every((status) => status === 200),
      upload.chunkResults,
    );

    const retry = await api(
      `/api/ads/uploads/${upload.uploadId}/chunks/0`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(upload.bytes.subarray(0, upload.chunkSize)),
      },
      ownerA.cookie,
    );
    const retryBody = await json(retry);
    check(
      'a retried chunk is idempotent',
      retry.status === 200 &&
        retryBody?.data?.receivedChunks === 3 &&
        retryBody?.data?.complete === true,
      retryBody?.data,
    );

    const shortChunk = await api(
      `/api/ads/uploads/${upload.uploadId}/chunks/0`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(upload.bytes.subarray(0, 1000)),
      },
      ownerA.cookie,
    );
    check('a short chunk is rejected', shortChunk.status === 400, shortChunk.status);

    const anonymousChunk = await api(
      `/api/ads/uploads/${upload.uploadId}/chunks/0`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(upload.bytes.subarray(0, upload.chunkSize)),
      },
    );
    check('an anonymous chunk write is rejected', anonymousChunk.status === 401, anonymousChunk.status);

    const foreignChunk = await api(
      `/api/ads/uploads/${upload.uploadId}/chunks/0`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(upload.bytes.subarray(0, upload.chunkSize)),
      },
      adminLogin.cookie,
    );
    check('an upload session is bound to the user who created it', foreignChunk.status === 404, foreignChunk.status);

    // ── Create ──────────────────────────────────────────────────────────────────
    const create = await api(
      '/api/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Summer promo',
          description: 'Played on the front-row machines',
          uploadId: upload.uploadId,
          kioskIds: [kioskA.id],
        }),
      },
      ownerA.cookie,
    );
    const createBody = await json(create);
    const adId: string | undefined = createBody?.data?.id;
    if (adId) createdAdIds.push(adId);
    check('ad is created from the upload session', create.status === 201, createBody);
    check(
      'server-derived size and kiosk assignment are returned',
      createBody?.data?.videoSizeBytes === 700_000 &&
        createBody?.data?.mimeType === 'video/mp4' &&
        Array.isArray(createBody?.data?.kioskIds) &&
        createBody.data.kioskIds.length === 1,
      createBody?.data,
    );

    const stored = adId
      ? await prisma.ad.findUniqueOrThrow({ where: { id: adId } })
      : null;
    check(
      'stored filename is server-minted and path-safe',
      !!stored && /^[0-9a-f-]{36}-\d+\.mp4$/.test(stored.videoFilename),
      stored?.videoFilename,
    );

    // ── Playback ────────────────────────────────────────────────────────────────
    const fullVideo = await api(`/api/ads/${adId}/video`, { method: 'GET' }, ownerA.cookie);
    const fullBytes = Buffer.from(await fullVideo.arrayBuffer());
    check(
      'full video streams with the stored type and exact length',
      fullVideo.status === 200 &&
        fullVideo.headers.get('content-type') === 'video/mp4' &&
        fullVideo.headers.get('x-content-type-options') === 'nosniff' &&
        fullBytes.length === 700_000 &&
        fullBytes.equals(upload.bytes),
      {
        status: fullVideo.status,
        type: fullVideo.headers.get('content-type'),
        length: fullBytes.length,
      },
    );

    const partial = await api(
      `/api/ads/${adId}/video`,
      { method: 'GET', headers: { range: 'bytes=100-199' } },
      ownerA.cookie,
    );
    const partialBytes = Buffer.from(await partial.arrayBuffer());
    check(
      'a byte range returns 206 with the requested slice',
      partial.status === 206 &&
        partial.headers.get('content-range') === 'bytes 100-199/700000' &&
        partialBytes.length === 100 &&
        partialBytes.equals(upload.bytes.subarray(100, 200)),
      { status: partial.status, range: partial.headers.get('content-range'), length: partialBytes.length },
    );

    const suffixRange = await api(
      `/api/ads/${adId}/video`,
      { method: 'GET', headers: { range: 'bytes=-100' } },
      ownerA.cookie,
    );
    const suffixBytes = Buffer.from(await suffixRange.arrayBuffer());
    check(
      'a suffix range returns the tail of the file',
      suffixRange.status === 206 && suffixBytes.equals(upload.bytes.subarray(699_900)),
      { status: suffixRange.status, length: suffixBytes.length },
    );

    const unsatisfiable = await api(
      `/api/ads/${adId}/video`,
      { method: 'GET', headers: { range: 'bytes=900000-' } },
      ownerA.cookie,
    );
    check('an out-of-bounds range is rejected with 416', unsatisfiable.status === 416, unsatisfiable.status);

    // ── Tenant isolation ────────────────────────────────────────────────────────
    // The schema allows exactly one COMPANY organization (`only_one_company` partial
    // unique index), so a second company — and therefore a cross-company read — cannot
    // be constructed. The reachable boundaries are the COMPANY gate and kiosk ownership.
    const listA = await json(await api('/api/ads', { method: 'GET' }, ownerA.cookie));
    check('the owning company sees its ad', listA?.data?.total === 1 && listA?.data?.items?.[0]?.id === adId, listA?.data?.total);

    const distributorRead = await api(`/api/ads/${adId}`, { method: 'GET' }, distributorLogin.cookie);
    check('a distributor cannot read a company ad', distributorRead.status === 403, distributorRead.status);

    const distributorVideo = await api(`/api/ads/${adId}/video`, { method: 'GET' }, distributorLogin.cookie);
    check('a distributor cannot stream a company video', distributorVideo.status === 403, distributorVideo.status);

    const companyUpload = await uploadVideo(ownerA.cookie, { totalSize: 1000 });
    const foreignCreate = await api(
      '/api/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'foreign kiosk', uploadId: companyUpload.uploadId, kioskIds: [kioskB.id] }),
      },
      ownerA.cookie,
    );
    const foreignCreateBody = await json(foreignCreate);
    check(
      'an ad cannot be attached to a distributor-owned kiosk',
      foreignCreate.status === 400,
      { status: foreignCreate.status, message: foreignCreateBody?.message },
    );

    const foreignFileCount = fs
      .readdirSync(UPLOAD_ROOT)
      .filter((name) => name.endsWith('.mp4')).length;
    check('the rejected create left no orphaned video file', foreignFileCount === 1, foreignFileCount);

    // ── Assignment rules ────────────────────────────────────────────────────────
    const toForeignKiosk = await api(
      `/api/ads/${adId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kioskIds: [kioskB.id] }),
      },
      ownerA.cookie,
    );
    check("assignment to another company's kiosk is rejected", toForeignKiosk.status === 400, toForeignKiosk.status);

    const toRetired = await api(
      `/api/ads/${adId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kioskIds: [kioskRetired.id] }),
      },
      ownerA.cookie,
    );
    check('assignment to a retired kiosk is rejected', toRetired.status === 400, toRetired.status);

    const update = await api(
      `/api/ads/${adId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Summer promo v2', kioskIds: [] }),
      },
      ownerA.cookie,
    );
    const updateBody = await json(update);
    check(
      'update replaces metadata and clears assignments with []',
      update.status === 200 &&
        updateBody?.data?.title === 'Summer promo v2' &&
        updateBody?.data?.kioskIds?.length === 0,
      updateBody?.data,
    );

    const emptyUpdate = await api(
      `/api/ads/${adId}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      ownerA.cookie,
    );
    check('an empty update is rejected', emptyUpdate.status === 400, emptyUpdate.status);

    // ── /api/v1 aliases ────────────────────────────────────────────────────────
    // The mobile contract addresses the same operations under /api/v1. These checks prove
    // each alias reaches the existing handler instead of a second implementation.
    const v1Filename = stored ? stored.videoFilename : '';

    const v1Config = await api('/api/v1/ads/config', { method: 'GET' }, ownerA.cookie);
    check('v1 config alias answers with the upload limits', v1Config.status === 200, v1Config.status);

    const v1List = await json(await api('/api/v1/ads', { method: 'GET' }, ownerA.cookie));
    check(
      'v1 list alias returns the library',
      v1List?.data?.items?.some((item: { id: string }) => item.id === adId) === true,
      v1List?.data?.total,
    );
    const listedAd = v1List?.data?.items?.find((item: { id: string }) => item.id === adId);
    check(
      'the ad list exposes the filename the files route addresses',
      !!stored && listedAd?.filename === stored.videoFilename,
      listedAd?.filename,
    );

    const v1Update = await api(
      `/api/v1/ads/${adId}/update`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Summer promo via v1' }),
      },
      ownerA.cookie,
    );
    const v1UpdateBody = await json(v1Update);
    check(
      'v1 POST /:id/update edits the ad',
      v1Update.status === 200 && v1UpdateBody?.data?.title === 'Summer promo via v1',
      v1UpdateBody?.data?.title,
    );

    // Replacing the video is part of the same update contract: the upload session supplies
    // the bytes and metadata, and the previous file must be gone afterwards. A dedicated ad
    // is used so the delete checks further down still describe the main fixture.
    const originalUpload = await uploadVideo(ownerA.cookie, {
      totalSize: 800,
      filename: 'original.mp4',
    });
    const replaceCreate = await api(
      '/api/v1/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Replace me', uploadId: originalUpload.uploadId, kioskIds: [] }),
      },
      ownerA.cookie,
    );
    const replaceCreateBody = await json(replaceCreate);
    const replaceAdId: string | undefined = replaceCreateBody?.data?.id;
    if (replaceAdId) createdAdIds.push(replaceAdId);
    const beforeReplace = replaceAdId
      ? await prisma.ad.findUniqueOrThrow({ where: { id: replaceAdId } })
      : null;

    const freshUpload = await uploadVideo(ownerA.cookie, {
      totalSize: 1200,
      filename: 'replacement.mp4',
    });
    const replaceUpdate = await api(
      `/api/v1/ads/${replaceAdId}/update`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId: freshUpload.uploadId, title: 'Replace me (new video)' }),
      },
      ownerA.cookie,
    );
    const replaceBody = await json(replaceUpdate);
    const afterReplace = replaceAdId
      ? await prisma.ad.findUniqueOrThrow({ where: { id: replaceAdId } })
      : null;
    check(
      'v1 POST /:id/update replaces the video from an upload session',
      replaceUpdate.status === 200 &&
        replaceBody?.data?.videoSizeBytes === 1200 &&
        replaceBody?.data?.originalFilename === 'replacement.mp4' &&
        !!beforeReplace &&
        replaceBody?.data?.filename !== beforeReplace.videoFilename,
      {
        status: replaceUpdate.status,
        filename: replaceBody?.data?.filename,
        size: replaceBody?.data?.videoSizeBytes,
      },
    );
    check(
      'the replaced file is deleted and the new one is on disk',
      !!beforeReplace &&
        !!afterReplace &&
        !fs.existsSync(path.join(UPLOAD_ROOT, beforeReplace.videoFilename)) &&
        fs.existsSync(path.join(UPLOAD_ROOT, afterReplace.videoFilename)),
      afterReplace?.videoFilename,
    );

    const replacedStream = afterReplace
      ? await api(
          `/api/v1/ads/files/${encodeURIComponent(afterReplace.videoFilename)}`,
          { method: 'GET' },
          ownerA.cookie,
        )
      : null;
    const replacedBytes = replacedStream ? Buffer.from(await replacedStream.arrayBuffer()) : Buffer.alloc(0);
    check(
      'the replacement bytes are the ones served',
      replacedStream?.status === 200 && replacedBytes.equals(freshUpload.bytes),
      { status: replacedStream?.status, length: replacedBytes.length },
    );

    const unknownReplacement = await api(
      `/api/v1/ads/${replaceAdId}/update`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId: '00000000-0000-4000-8000-000000000000' }),
      },
      ownerA.cookie,
    );
    const afterFailedReplace = replaceAdId
      ? await prisma.ad.findUniqueOrThrow({ where: { id: replaceAdId } })
      : null;
    check(
      'an unknown replacement upload is rejected and the ad keeps its video',
      unknownReplacement.status === 404 &&
        !!afterReplace &&
        afterFailedReplace?.videoFilename === afterReplace.videoFilename,
      { status: unknownReplacement.status },
    );

    const deleteReplaced = await api(`/api/v1/ads/${replaceAdId}/delete`, { method: 'POST' }, ownerA.cookie);
    const deletedRow = replaceAdId
      ? await prisma.ad.findUnique({ where: { id: replaceAdId } })
      : null;
    check(
      'v1 POST /:id/delete removes the row and the replacement file',
      deleteReplaced.status === 200 &&
        deletedRow === null &&
        !!afterReplace &&
        !fs.existsSync(path.join(UPLOAD_ROOT, afterReplace.videoFilename)),
      { status: deleteReplaced.status },
    );

    const v1Video = await api(`/api/v1/ads/files/${v1Filename}`, { method: 'GET' }, ownerA.cookie);
    const v1VideoBytes = Buffer.from(await v1Video.arrayBuffer());
    check(
      'v1 file route streams by stored filename',
      v1Video.status === 200 && v1VideoBytes.length === 700_000,
      { status: v1Video.status, length: v1VideoBytes.length },
    );

    const unknownFile = await api(
      '/api/v1/ads/files/00000000-0000-0000-0000-000000000000-1.mp4',
      { method: 'GET' },
      ownerA.cookie,
    );
    check('v1 file route hides an unknown filename', unknownFile.status === 404, unknownFile.status);

    const v1Range = await api(
      `/api/v1/ads/files/${encodeURIComponent(v1Filename)}`,
      { method: 'GET', headers: { range: 'bytes=100-199' } },
      ownerA.cookie,
    );
    const v1RangeBytes = Buffer.from(await v1Range.arrayBuffer());
    check(
      'v1 file route honours a byte range for seeking',
      v1Range.status === 206 &&
        v1Range.headers.get('content-range') === 'bytes 100-199/700000' &&
        v1RangeBytes.equals(upload.bytes.subarray(100, 200)),
      {
        status: v1Range.status,
        range: v1Range.headers.get('content-range'),
        length: v1RangeBytes.length,
      },
    );

    const v1Headers = await api(
      `/api/v1/ads/files/${encodeURIComponent(v1Filename)}`,
      { method: 'GET' },
      ownerA.cookie,
    );
    check(
      'v1 file route advertises inline playback with the stored type',
      v1Headers.status === 200 &&
        v1Headers.headers.get('content-type') === 'video/mp4' &&
        v1Headers.headers.get('accept-ranges') === 'bytes' &&
        (v1Headers.headers.get('content-disposition') ?? '').startsWith('inline;') &&
        v1Headers.headers.get('x-content-type-options') === 'nosniff',
      {
        type: v1Headers.headers.get('content-type'),
        ranges: v1Headers.headers.get('accept-ranges'),
        disposition: v1Headers.headers.get('content-disposition'),
      },
    );

    const traversal = await api(
      `/api/v1/ads/files/${encodeURIComponent('../app.ts')}`,
      { method: 'GET' },
      ownerA.cookie,
    );
    check('v1 file route rejects a path-like filename', traversal.status === 400, traversal.status);

    const distributorFile = await api(
      `/api/v1/ads/files/${encodeURIComponent(v1Filename)}`,
      { method: 'GET' },
      distributorLogin.cookie,
    );
    check(
      'v1 file route is closed to a distributor',
      distributorFile.status === 403,
      distributorFile.status,
    );

    const v1Upload = await uploadVideo(ownerA.cookie, { totalSize: 1000 });
    const v1Create = await api(
      '/api/v1/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'v1 throwaway', uploadId: v1Upload.uploadId, kioskIds: [] }),
      },
      ownerA.cookie,
    );
    const v1CreateBody = await json(v1Create);
    const v1AdId: string | undefined = v1CreateBody?.data?.id;
    if (v1AdId) createdAdIds.push(v1AdId);
    check('v1 create alias creates an ad', v1Create.status === 201 && !!v1AdId, v1Create.status);

    const v1Delete = await api(`/api/v1/ads/${v1AdId}/delete`, { method: 'POST' }, ownerA.cookie);
    check('v1 POST /:id/delete deletes the ad', v1Delete.status === 200, v1Delete.status);

    const v1Gone = await api(`/api/ads/${v1AdId}`, { method: 'GET' }, ownerA.cookie);
    check('the ad deleted through the v1 alias is gone', v1Gone.status === 404, v1Gone.status);

    // ── Multipart chunk contract (`POST /api/v1/ads/upload-chunk`) ──────────────
    // The mobile contract sends one multipart request per chunk instead of raw bytes. It
    // must drive the same resumable session, so these checks upload a whole video through
    // it and then create the ad from that session.
    const multipartBytes = crypto.randomBytes(600_000);
    const multipartChunkSize = 256 * 1024;
    const multipartTotalChunks = Math.ceil(multipartBytes.length / multipartChunkSize);

    async function sendMultipartChunk(
      fields: Record<string, string>,
      data: Buffer,
    ): Promise<Response> {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set('file', new Blob([new Uint8Array(data)]), 'chunk.bin');
      return api('/api/v1/ads/upload-chunk', { method: 'POST', body: form }, ownerA.cookie);
    }

    const firstChunk = await sendMultipartChunk(
      {
        filename: 'Multipart Clip.mp4',
        mimeType: 'video/mp4',
        totalSize: String(multipartBytes.length),
        chunkIndex: '0',
      },
      multipartBytes.subarray(0, multipartChunkSize),
    );
    const firstChunkBody = await json(firstChunk);
    const multipartUploadId: string | undefined = firstChunkBody?.data?.uploadId;
    check(
      'upload-chunk starts a session from the first multipart chunk',
      firstChunk.status === 200 &&
        !!multipartUploadId &&
        firstChunkBody?.data?.totalChunks === multipartTotalChunks &&
        firstChunkBody?.data?.complete === false,
      firstChunkBody?.data,
    );

    let lastChunkBody: any = null;
    for (let index = 1; index < multipartTotalChunks; index += 1) {
      const start = index * multipartChunkSize;
      const end = Math.min(start + multipartChunkSize, multipartBytes.length);
      const response = await sendMultipartChunk(
        { uploadId: multipartUploadId ?? '', chunkIndex: String(index) },
        multipartBytes.subarray(start, end),
      );
      lastChunkBody = await json(response);
    }
    check(
      'upload-chunk reports completion on the last chunk',
      lastChunkBody?.data?.complete === true &&
        lastChunkBody?.data?.receivedChunks === multipartTotalChunks,
      lastChunkBody?.data,
    );

    const multipartCreate = await api(
      '/api/v1/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Multipart clip', uploadId: multipartUploadId, kioskIds: [] }),
      },
      ownerA.cookie,
    );
    const multipartCreateBody = await json(multipartCreate);
    const multipartAdId: string | undefined = multipartCreateBody?.data?.id;
    if (multipartAdId) createdAdIds.push(multipartAdId);
    check(
      'the ad created from multipart chunks keeps the declared byte length',
      multipartCreate.status === 201 && multipartCreateBody?.data?.videoSizeBytes === 600_000,
      { status: multipartCreate.status, size: multipartCreateBody?.data?.videoSizeBytes },
    );

    const notMultipart = await api(
      '/api/v1/ads/upload-chunk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId: 'x' }),
      },
      ownerA.cookie,
    );
    check('upload-chunk rejects a non-multipart body', notMultipart.status === 415, notMultipart.status);

    const anonymousMultipart = await api('/api/v1/ads/upload-chunk', { method: 'POST', body: new FormData() });
    check('upload-chunk is auth-gated', anonymousMultipart.status === 401, anonymousMultipart.status);

    const filesAliasAnon = await api('/api/v1/ads/files', { method: 'POST', body: new FormData() });
    check('POST /api/v1/ads/files is auth-gated', filesAliasAnon.status === 401, filesAliasAnon.status);

    const singleFileForm = new FormData();
    const singleFileBytes = crypto.randomBytes(5000);
    singleFileForm.set('file', new Blob([new Uint8Array(singleFileBytes)]), 'single.mp4');
    singleFileForm.set('mimeType', 'video/mp4');
    const filesAliasUpload = await api('/api/v1/ads/files', { method: 'POST', body: singleFileForm }, ownerA.cookie);
    const filesAliasUploadBody = await json(filesAliasUpload);
    check(
      'POST /api/v1/ads/files accepts a single-file multipart upload',
      filesAliasUpload.status === 200 && filesAliasUploadBody?.data?.complete === true,
      filesAliasUploadBody?.data,
    );

    // ── Device-reported ad files ────────────────────────────────────────────────
    // Mothership reports a kiosk's ad files by name and serves no bytes for them, so the
    // fleet endpoint resolves each name against this account's ad library. These checks
    // cover that resolution and the download response without calling the upstream host.
    const kioskUpload = await uploadVideo(ownerA.cookie, {
      totalSize: 1000,
      filename: 'Kiosk Promo.MP4',
    });
    const kioskCreate = await api(
      '/api/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Kiosk promo', uploadId: kioskUpload.uploadId, kioskIds: [kioskA.id] }),
      },
      ownerA.cookie,
    );
    const kioskCreateBody = await json(kioskCreate);
    const kioskAdId: string | undefined = kioskCreateBody?.data?.id;
    if (kioskAdId) createdAdIds.push(kioskAdId);
    const kioskStored = kioskAdId
      ? await prisma.ad.findUniqueOrThrow({ where: { id: kioskAdId } })
      : null;
    check(
      'an ad can be uploaded under a kiosk-style filename',
      kioskCreate.status === 201 && !!kioskStored,
      kioskCreate.status,
    );

    const libraryWhere = (name: string) => ({
      organizationId: companyA,
      originalFilename: { in: [name], mode: 'insensitive' as const },
    });
    const librarySelect = {
      id: true,
      originalFilename: true,
      videoFilename: true,
      status: true,
    } as const;

    const libraryRows = await prisma.ad.findMany({
      where: libraryWhere('kiosk promo.mp4'),
      select: librarySelect,
    });
    check(
      'library lookup matches a reported name case-insensitively',
      libraryRows.length === 1 && libraryRows[0]?.id === kioskAdId,
      libraryRows.map((row) => row.originalFilename),
    );

    const deviceView = (files: string[]) => ({
      deviceId: 'ADLX-VERIFY-1',
      hardwareUuid: null,
      headscaleIp: null,
      isOnline: false,
      kioskNumber: null,
      lastSeen: null,
      location: null,
      publicIp: null,
      ads: files.map((file) => ({
        file,
        title: file,
        sizeBytes: 1000,
        version: 0,
        managed: false,
        startDate: null,
        expiresOn: null,
        inLibrary: false,
        adId: null,
        status: null,
        playUrl: null,
        downloadUrl: null,
      })),
    });

    const resolved = attachLibraryAds(
      [deviceView(['KIOSK PROMO.MP4', 'not-in-library.webm'])],
      libraryRows,
    )[0];
    const matched = resolved?.ads.find((ad) => ad.file === 'KIOSK PROMO.MP4');
    const unmatched = resolved?.ads.find((ad) => ad.file === 'not-in-library.webm');
    check(
      'a reported file present in the library is marked playable',
      matched?.inLibrary === true && matched?.adId === kioskAdId && matched?.status === 'ACTIVE',
      matched,
    );
    check(
      'the play URL addresses the stored copy',
      matched?.playUrl === `/api/ads/files/${encodeURIComponent(kioskStored?.videoFilename ?? '')}`,
      matched?.playUrl,
    );
    check(
      'the download URL adds the attachment flag',
      matched?.downloadUrl === `${matched?.playUrl}?download=1`,
      matched?.downloadUrl,
    );
    check(
      'a reported file with no library copy gets no URLs',
      unmatched?.inLibrary === false && unmatched?.playUrl === null && unmatched?.downloadUrl === null,
      unmatched,
    );

    // A re-upload leaves two rows sharing one name; the ACTIVE row must win regardless of
    // the order the database returns them in.
    const duplicateUpload = await uploadVideo(ownerA.cookie, {
      totalSize: 1000,
      filename: 'kiosk promo.mp4',
    });
    const duplicateCreate = await api(
      '/api/ads',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Kiosk promo (copy)', uploadId: duplicateUpload.uploadId, kioskIds: [] }),
      },
      ownerA.cookie,
    );
    const duplicateBody = await json(duplicateCreate);
    const duplicateId: string | undefined = duplicateBody?.data?.id;
    if (duplicateId) {
      createdAdIds.push(duplicateId);
      await prisma.ad.update({ where: { id: duplicateId }, data: { status: 'INACTIVE' } });
    }
    const withDuplicate = await prisma.ad.findMany({
      where: libraryWhere('kiosk promo.mp4'),
      select: librarySelect,
    });
    const preferred = attachLibraryAds(
      [deviceView(['kiosk promo.mp4'])],
      withDuplicate,
    )[0];
    check(
      'the ACTIVE duplicate wins over an inactive one',
      withDuplicate.length === 2 && preferred?.ads[0]?.adId === kioskAdId,
      { rows: withDuplicate.length, chosen: preferred?.ads[0]?.adId },
    );

    const storedName = encodeURIComponent(kioskStored?.videoFilename ?? '');
    const download = await api(`/api/ads/files/${storedName}?download=1`, { method: 'GET' }, ownerA.cookie);
    const downloadBytes = Buffer.from(await download.arrayBuffer());
    check(
      'the download flag turns playback into a file download',
      download.status === 200 &&
        (download.headers.get('content-disposition') ?? '').startsWith('attachment;') &&
        downloadBytes.equals(kioskUpload.bytes),
      {
        status: download.status,
        disposition: download.headers.get('content-disposition'),
        length: downloadBytes.length,
      },
    );

    const inline = await api(`/api/ads/files/${storedName}`, { method: 'GET' }, ownerA.cookie);
    check(
      'playback stays inline without the flag',
      inline.status === 200 && (inline.headers.get('content-disposition') ?? '').startsWith('inline;'),
      inline.headers.get('content-disposition'),
    );

    // The alias must be gated before it reaches Mothership: an anonymous call is answered
    // locally, so this never depends on the upstream host being reachable.
    const anonymousDevices = await api('/api/v1/devices', { method: 'GET' });
    check('the v1 devices alias is auth-gated', anonymousDevices.status === 401, anonymousDevices.status);

    // ── Upload expiry ───────────────────────────────────────────────────────────
    const expired = await uploadVideo(ownerA.cookie, { totalSize: 1000 });
    const removed = await adsService.cleanupExpiredUploads(0);
    const afterSweep = await api(
      `/api/ads/uploads/${expired.uploadId}/chunks/0`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(expired.bytes.subarray(0, 1000)),
      },
      ownerA.cookie,
    );
    check(
      'an abandoned upload is swept and its chunks stop being accepted',
      removed >= 1 && afterSweep.status === 404,
      { removed, status: afterSweep.status },
    );

    // ── Delete ──────────────────────────────────────────────────────────────────
    const deleted = await api(`/api/ads/${adId}`, { method: 'DELETE' }, ownerA.cookie);
    check('ad is deleted', deleted.status === 200, deleted.status);

    const storedFile = stored ? path.join(UPLOAD_ROOT, stored.videoFilename) : '';
    check('the stored video file is removed from disk', !!stored && !fs.existsSync(storedFile), storedFile);

    const gone = await api(`/api/ads/${adId}`, { method: 'GET' }, ownerA.cookie);
    check('the deleted ad is no longer readable', gone.status === 404, gone.status);

    const deleteAgain = await api(`/api/ads/${adId}`, { method: 'DELETE' }, ownerA.cookie);
    check('deleting twice returns 404', deleteAgain.status === 404, deleteAgain.status);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Best-effort fixture cleanup; the scratch database is disposable either way.
    await prisma.adKiosk.deleteMany({ where: { adId: { in: createdAdIds } } }).catch(() => undefined);
    await prisma.ad.deleteMany({ where: { id: { in: createdAdIds } } }).catch(() => undefined);
    await prisma.kiosk.deleteMany({ where: { id: { in: createdKioskIds } } }).catch(() => undefined);
    // Delete memberships by user, not by organization: the extra member belongs to the
    // seeded company, so scoping by created organizations left that row behind and its
    // foreign key then blocked the user delete, leaving fixtures for the next run.
    await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } }).catch(() => undefined);
    await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => undefined);

    await prisma.$disconnect();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      // fetch keeps sockets alive; without this the close callback can wait forever.
      server.closeAllConnections();
    });

    const evidence = {
      verifiedAt: new Date().toISOString(),
      database: 'arcadelx_ads_verify (localhost:5433, scratch)',
      uploadRoot: UPLOAD_ROOT,
      limits: { maxVideoSizeBytes: 1024 * 1024, maxChunkSizeBytes: 256 * 1024 },
      passed: checks.filter((entry) => entry.ok).length,
      failed: failures.length,
      failures,
      checks,
    };
    fs.mkdirSync('audits/ads', { recursive: true });
    fs.writeFileSync('audits/ads/verification.json', JSON.stringify(evidence, null, 2));

    fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });

    console.log(`\n${evidence.passed}/${checks.length} checks passed`);
    if (failures.length > 0) {
      console.error(`Failed: ${failures.join(' | ')}`);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
