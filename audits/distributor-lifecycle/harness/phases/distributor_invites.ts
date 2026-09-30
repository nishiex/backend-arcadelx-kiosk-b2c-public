import assert from 'node:assert/strict';
import pg from 'pg';

// Real HTTP + PostgreSQL checks. The harness creates a fresh local database,
// applies repository migrations and captures all email without external sends.
export async function run(c: any) {
  const { prisma, sql } = c;
  const company = c.company ?? await c.fixture('invite-company', 'COMPANY');
  const admin = await c.fixture('invite-admin', 'COMPANY', company.orgId, 'ADMIN');
  const distributor = await c.fixture('invite-other-org', 'DISTRIBUTOR');
  const route = '/api/auth/register';
  const body = (label: string, inviteCode?: unknown) => ({
    ...c.registration(`invite-${label}`),
    ...(inviteCode === undefined ? {} : { inviteCode }),
  });
  const counts = async () => Promise.all([
    prisma.user.count(), prisma.organization.count(),
    prisma.membership.count(), prisma.emailDelivery.count(),
  ]);
  const companyInvite = () => prisma.organization.findUniqueOrThrow({
    where: { id: company.orgId },
    select: { inviteCode: true, inviteCodeExpiresAt: true },
  });
  const hit = async (label: string, actor: any, input: unknown, expected = 400) => {
    const r = await c.http(`invite-${label}`, actor, 'POST', route, input, expected);
    assert.equal(r.status, expected, label);
    return r;
  };
  const reject = async (label: string, input: unknown, actor = company, expected = 400) => {
    const before = await counts();
    const codeBefore = await companyInvite();
    const r = await hit(label, actor, input, expected);
    assert.equal(r.data.success, false);
    assert.deepEqual(await counts(), before, `${label}: no partial records`);
    assert.deepEqual(await companyInvite(), codeBefore, `${label}: invite retained`);
    c.check(`invite-${label}-atomic`, true);
    return r;
  };

  let code = await c.invite(company);
  for (const [label, value] of [
    ['missing', undefined], ['empty', ''], ['whitespace', '   '],
    ['null', null], ['wrong-type', 123], ['too-long', 'x'.repeat(11)],
  ] as const) {
    const r = await reject(label, body(label, value));
    assert.ok(r.data.errors.some((e: any) => e.path.includes('inviteCode')));
  }
  await reject('unknown', body('unknown', 'not-found'));
  await prisma.organization.update({ where: { id: company.orgId }, data: {
    inviteCodeExpiresAt: new Date(Date.now() - 1000),
  } });
  await reject('expired', body('expired', code));

  // Non-Company codes cannot authorize creation even if supplied with a forged ID.
  await prisma.organization.update({ where: { id: distributor.orgId }, data: {
    inviteCode: 'OtherOrg', inviteCodeExpiresAt: new Date(Date.now() + 60000),
  } });
  await reject('non-company-code', { ...body('non-company', 'OtherOrg'), companyId: distributor.orgId });

  // Production permits one Company. Temporarily allow a second adversarial
  // fixture ONLY in this new local DB to independently verify the Company-ID gate.
  assert.equal(c.auditUrl.hostname, 'localhost');
  assert.match(c.auditUrl.pathname, /^\/arcadelx_audit_\d+$/);
  await sql.query('DROP INDEX "only_one_company"');
  let otherCompany: any;
  try {
    otherCompany = await c.fixture('invite-other-company', 'COMPANY');
    const otherCode = await c.invite(otherCompany);
    await reject('wrong-company', {
      ...body('wrong-company', otherCode), organizationId: otherCompany.orgId,
    });
    assert.equal((await prisma.organization.findUniqueOrThrow({
      where: { id: otherCompany.orgId },
    })).inviteCode, otherCode);
  } finally {
    if (otherCompany) await prisma.organization.update({
      where: { id: otherCompany.orgId }, data: { type: 'PARTNER' },
    });
    await sql.query(`CREATE UNIQUE INDEX "only_one_company" ON "Organization" ("type") WHERE "type" = 'COMPANY'`);
  }

  code = await c.invite(company);
  await reject('anonymous', body('anonymous', code), null, 401);
  for (const role of ['MANAGER', 'STAFF']) {
    const actor = await c.fixture(`invite-${role.toLowerCase()}`, 'COMPANY', company.orgId, role);
    await reject(`role-${role}`, body(`role-${role}`, code), actor, 403);
  }
  const pending = await c.fixture('invite-pending', 'COMPANY', company.orgId, 'ADMIN', 'PENDING');
  await reject('pending', body('pending', code), pending, 403);
  await reject('distributor-cannot-create', body('forbidden-child', code), distributor, 403);

  // Partner registration does not require or consume the Company's invite.
  await c.register('invite-company-partner', company, 'PARTNER');
  await c.register('invite-distributor-partner', distributor, 'PARTNER');
  assert.equal((await companyInvite()).inviteCode, code);
  const join = await c.http('invite-existing-join-flow', null, 'POST', '/api/auth/join', {
    name: 'Invite joining member', email: 'invite-join@example.invalid',
    password: c.password, inviteCode: code,
  }, 201);
  assert.equal(join.status, 201);
  const joined = await prisma.user.findUniqueOrThrow({
    where: { email: 'invite-join@example.invalid' }, include: { membership: true },
  });
  assert.equal(joined.membership.status, 'PENDING');
  assert.equal(joined.membership.organizationId, company.orgId);
  assert.equal((await companyInvite()).inviteCode, code);
  c.check('invite-other-registration-flows-preserved', true);

  const created = await hit('valid-company-owner', company, body('valid', ` ${code} `), 201);
  assert.equal(created.cookies, '', 'creator session must not be replaced');
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: created.data.data.organization.id }, include: { owner: true, memberships: true },
  });
  assert.equal(org.type, 'DISTRIBUTOR');
  assert.equal(org.owner.email, body('valid').ownerEmail);
  assert.equal(org.memberships.length, 1);
  assert.equal(org.memberships[0].userId, org.ownerId);
  assert.equal(org.memberships[0].role, 'OWNER');
  assert.equal(org.memberships[0].status, 'ACTIVE');
  const delivery = await prisma.emailDelivery.findUniqueOrThrow({ where: { key: `organization:${org.id}:credentials` } });
  assert.equal(delivery.ownerOrganizationId, company.orgId);
  assert.equal(created.data.data.credentialsEmailSent, true);
  assert.deepEqual(await companyInvite(), { inviteCode: null, inviteCodeExpiresAt: null });
  c.check('invite-owner-organization-membership-delivery-preserved', true);
  await reject('already-used', body('reuse', code));

  // A database failure after consumption must restore the code and roll back owner.
  code = await c.invite(company);
  await sql.query(`ALTER TABLE "Organization" ADD CONSTRAINT invite_test_failure CHECK (name <> 'invite-rollback')`);
  try {
    const before = await counts();
    const result = await c.http('invite-rollback', company, 'POST', route, body('rollback', code), [409, 500]);
    assert.ok([409, 500].includes(result.status));
    assert.deepEqual(await counts(), before);
    assert.equal((await companyInvite()).inviteCode, code);
    c.check('invite-rollback-retains-code-and-no-owner', true);
  } finally {
    await sql.query('ALTER TABLE "Organization" DROP CONSTRAINT invite_test_failure');
  }
  await hit('valid-company-admin-after-rollback', admin, body('after-rollback', code), 201);

  code = await c.invite(company);
  const before = await counts();
  const blocker = new pg.Client({ connectionString: c.auditUrl.href, application_name: 'invite_barrier' });
  await blocker.connect();
  await blocker.query('BEGIN');
  await blocker.query('SELECT id FROM "Organization" WHERE id=$1 FOR UPDATE', [company.orgId]);
  const pendingRace = Promise.all(['one', 'two'].map(label =>
    c.http(`invite-race-${label}`, company, 'POST', route, body(`race-${label}`, code), [201, 400]),
  ));
  let waiting = 0;
  try {
    const deadline = Date.now() + 2500;
    do {
      waiting = Number((await sql.query(`SELECT count(*) FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
        AND application_name<>'invite_barrier'`)).rows[0].count);
      if (waiting >= 2) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
  } finally {
    await blocker.query('COMMIT');
    await blocker.end();
  }
  const raced = await pendingRace;
  assert.ok(waiting >= 2, 'both registrations must overlap at invite consumption');
  assert.deepEqual(raced.map(r => r.status).sort(), [201, 400]);
  assert.deepEqual(await counts(), before.map((count: number) => count + 1));
  c.check('invite-concurrent-use-creates-exactly-one-distributor', true);
}
