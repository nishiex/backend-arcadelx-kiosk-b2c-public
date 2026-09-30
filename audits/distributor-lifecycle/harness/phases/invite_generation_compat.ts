import assert from 'node:assert/strict';

// Exercise the deployed schema gap only in the harness's fresh local database.
export async function run(c: any) {
  assert.equal(c.auditUrl.hostname, 'localhost');
  assert.match(c.auditUrl.pathname, /^\/arcadelx_audit_\d+$/);
  const existingCompany = await c.prisma.organization.findFirst({
    where: { type: 'COMPANY' }, select: { id: true },
  });
  const company = c.company ?? await c.fixture('invite-compat-company', 'COMPANY', existingCompany?.id);
  const admin = await c.fixture('invite-compat-admin', 'COMPANY', company.orgId, 'ADMIN');
  const staff = await c.fixture('invite-compat-staff', 'COMPANY', company.orgId, 'STAFF');
  const distributor = await c.fixture('invite-compat-distributor', 'DISTRIBUTOR');
  const readInvite = () => c.prisma.organization.findUniqueOrThrow({
    where: { id: company.orgId }, select: { inviteCode: true, inviteCodeExpiresAt: true },
  });
  const generate = async (label: string, actor: unknown) => {
    const before = Date.now();
    const response = await c.http(label, actor, 'POST', '/api/members/generateInviteCode', undefined, 201);
    assert.equal(response.status, 201);
    const result = response.data.data;
    assert.equal(result.inviteCode.length, 6);
    assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'inviteCode']);
    const stored = await readInvite();
    assert.equal(stored.inviteCode, result.inviteCode);
    assert.equal(stored.inviteCodeExpiresAt.toISOString(), result.expiresAt);
    const expiry = Date.parse(result.expiresAt);
    assert.ok(expiry >= before + 7 * 86400000 && expiry <= Date.now() + 7 * 86400000);
    c.check(`${label}-stored-code-and-expiry`, true);
    return result.inviteCode;
  };

  await generate('invite-generation-current-schema', company);
  const renamed: string[] = [];
  try {
    for (const column of ['gstNumber', 'phone', 'country']) {
      await c.sql.query(`ALTER TABLE "Organization" RENAME COLUMN "${column}" TO "invite_test_${column}"`);
      renamed.push(column);
    }
    const firstCode = await generate('invite-generation-deployed-schema-owner', company);
    const nextCode = await generate('invite-generation-deployed-schema-admin', admin);
    assert.notEqual(firstCode, nextCode);
    const beforeDenied = await readInvite();
    for (const [label, actor, expected] of [
      ['anonymous', null, 401], ['staff', staff, 403], ['distributor', distributor, 403],
    ] as const) {
      const response = await c.http(`invite-generation-deny-${label}`, actor, 'POST', '/api/members/generateInviteCode', undefined, expected);
      assert.equal(response.status, expected);
      assert.deepEqual(await readInvite(), beforeDenied);
    }
    c.check('invite-generation-scoping-preserved-on-deployed-schema', true);
  } finally {
    for (const column of renamed) {
      await c.sql.query(`ALTER TABLE "Organization" RENAME COLUMN "invite_test_${column}" TO "${column}"`);
    }
  }
  await generate('invite-generation-restored-schema', company);
}
