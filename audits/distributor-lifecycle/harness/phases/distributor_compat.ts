import assert from 'node:assert/strict';

// Only the NEW local harness database is altered. Renaming keeps fixture data
// intact while exercising old, partial and fully migrated profile schemas.
export async function run(c: any) {
  const company = await c.fixture('compat-company', 'COMPANY');
  const profile = { gstNumber: 'COMPAT-GST', phone: '9999999999', country: 'India' };
  const distributor = await c.register('compat-distributor', company, 'DISTRIBUTOR', profile);
  async function listing(id: string, expectedProfile: typeof profile | { gstNumber: null; phone: string | null; country: null }) {
    const response = await c.http(id, company, 'GET', '/api/network/distributors', undefined, 200);
    assert.equal(response.status, 200);
    const rows = response.data.data.distributors;
    const row = rows.find((item: any) => item.id === distributor.orgId);
    const passed = rows.length === 1 && row.name === 'compat-distributor' && row.owner.email === distributor.email && row._count.memberships === 1 && row._count.kiosks === 0 && Object.entries(expectedProfile).every(([field,value]) => row[field] === value);
    c.check(id + '-fields', passed);
    assert(passed);
  }
  await listing('distributors-migrated-schema', profile);
  await c.http('distributors-unauthenticated-denied', null, 'GET', '/api/network/distributors', undefined, 401);
  await c.http('distributors-wrong-org-type-denied', distributor, 'GET', '/api/network/distributors', undefined, 403);
  const renamed = new Set<string>();
  try {
    for (const column of ['gstNumber', 'phone', 'country']) {
      await c.sql.query(`ALTER TABLE "Organization" RENAME COLUMN "${column}" TO "audit_legacy_${column}"`);
      renamed.add(column);
    }
    await listing('distributors-legacy-schema', { gstNumber: null, phone: null, country: null });
    await c.sql.query('ALTER TABLE "Organization" RENAME COLUMN "audit_legacy_phone" TO "phone"');
    renamed.delete('phone');
    await listing('distributors-partial-schema', { gstNumber: null, phone: profile.phone, country: null });
  } finally {
    for (const column of renamed) await c.sql.query(`ALTER TABLE "Organization" RENAME COLUMN "audit_legacy_${column}" TO "${column}"`);
  }
  await listing('distributors-restored-schema', profile);
}
