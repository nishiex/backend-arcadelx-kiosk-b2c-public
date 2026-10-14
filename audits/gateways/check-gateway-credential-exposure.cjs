/**
 * Classifies how Mothership's world-readable gateway list exposes credential material.
 *
 * `GET /api/v1/admin/gateways` answers 200 without any credentials (documented in
 * `apps/api/src/services/Mothership/gateways.service.ts`), which is why our own
 * `/api/admin/gateways` route is gated by session auth. That raises a second question the
 * service comment does not answer: are the credential VALUES masked upstream, or does an
 * anonymous caller receive usable payment keys?
 *
 * This probe never prints or stores a credential value. For each field it records only:
 *   - the field NAME,
 *   - `masked` when the value contains asterisks,
 *   - `unmasked` otherwise, with the value's length and character class,
 *   - `non-string` for anything that is not a string.
 *
 * Read-only: it issues one GET and writes nothing anywhere but this folder.
 *
 * Usage: node audits/gateways/check-gateway-credential-exposure.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = process.env.MOTHERSHIP_GATEWAYS_URL
  ?? 'https://main.arcadelx.games/api/v1/admin/gateways';
const OUT = path.join(__dirname, 'gateway-credential-exposure.json');

function classify(value) {
  if (typeof value !== 'string') return { shape: 'non-string', type: typeof value };
  const masked = value.includes('*');
  return {
    shape: masked ? 'masked' : 'unmasked',
    length: value.length,
    characterClass: /^[A-Za-z0-9]+$/.test(value)
      ? 'alphanumeric'
      : /^[A-Za-z0-9_\-]+$/.test(value)
        ? 'alphanumeric+_-.'
        : 'other',
  };
}

(async () => {
  const response = await fetch(SOURCE, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  const body = JSON.parse(text);

  const report = {
    generatedAt: new Date().toISOString(),
    url: SOURCE,
    status: response.status,
    authenticated: false,
    total: body.total,
    gateways: (body.gateways ?? []).map((gateway) => ({
      provider: gateway.provider,
      is_active: gateway.is_active,
      credentialFields: Object.fromEntries(
        Object.entries(gateway.credentials ?? {}).map(([field, value]) => [field, classify(value)]),
      ),
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`GET ${SOURCE} -> HTTP ${response.status} (no credentials sent)`);
  for (const gateway of report.gateways) {
    console.log(`  ${gateway.provider}:`);
    for (const [field, info] of Object.entries(gateway.credentialFields)) {
      console.log(`    ${field}: ${info.shape}${info.length ? ` len=${info.length} ${info.characterClass}` : ''}`);
    }
  }
  console.log('wrote', OUT);
})().catch((error) => {
  console.error('PROBE FAILED:', error.message);
  process.exit(1);
});
