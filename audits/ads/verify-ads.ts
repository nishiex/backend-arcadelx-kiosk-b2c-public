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

  const server = app.listen(4010, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));

  const suffix = Date.now();
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

    const distributor = await makeCompany('dist', 'DISTRIBUTOR', '9000000003');

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

    const adminA = await makeCompanyMember(companyA, 'ADMIN', '9000000005');

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
    await prisma.membership.deleteMany({ where: { organizationId: { in: createdOrgIds } } }).catch(() => undefined);
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
