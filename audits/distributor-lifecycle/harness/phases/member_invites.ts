import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Real handlers and isolated local fixtures. No remote writes or external email.
export async function run(c: any) {
  const { prisma, http, check } = c;
  const owner = c.company;
  const admin = await c.fixture('member-invite-admin', 'COMPANY', owner.orgId, 'ADMIN');
  const manager = await c.fixture('member-invite-manager', 'COMPANY', owner.orgId, 'MANAGER');
  const staff = await c.fixture('member-invite-staff', 'COMPANY', owner.orgId, 'STAFF');
  const distributor = await c.fixture('member-invite-distributor', 'DISTRIBUTOR');
  const partner = await c.fixture('member-invite-partner', 'PARTNER');
  const generate = async (actor: any, role: string) => (await http('member-invite-generate-' + role, actor, 'POST', '/api/members/generateInviteCode', { role }, 201)).data.data.inviteCode;
  const registration = (code: string) => ({ name: 'Invited colleague', email: `invite-${crypto.randomUUID()}@example.invalid`, password: c.password, inviteCode: code });
  for (const actor of [manager, staff, distributor, partner]) {
    await http('member-invite-unauthorized-' + actor.role + '-' + actor.type, actor, 'POST', '/api/members/generateInviteCode', { role: 'STAFF' }, 403);
  }
  await http('member-invite-anonymous-denied', null, 'POST', '/api/members/generateInviteCode', { role: 'STAFF' }, 401);
  await http('member-invite-admin-cannot-grant-admin', admin, 'POST', '/api/members/generateInviteCode', { role: 'ADMIN' }, 403);
  await http('member-invite-owner-role-denied', owner, 'POST', '/api/members/generateInviteCode', { role: 'OWNER' }, 400);

  for (const role of ['ADMIN', 'MANAGER', 'STAFF']) {
    const code = await generate(role === 'ADMIN' ? owner : admin, role);
    const input = registration(code);
    const organizationsBefore = await prisma.organization.count();
    const joined = await http('member-invite-register-' + role, null, 'POST', '/api/auth/join', { ...input, role: 'OWNER', organizationId: distributor.orgId }, 201);
    assert.equal(joined.data.data.membership.role, role, 'Only Company-selected role is assigned');
    assert.equal(joined.data.data.membership.status, 'ACTIVE');
    assert.equal(joined.data.data.membership.organizationId, owner.orgId, 'Company comes from stored invite');
    assert.equal(await prisma.organization.count(), organizationsBefore);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: input.email }, include: { membership: true } });
    assert.equal(user.membership.role, role);
    assert.equal(user.membership.organizationId, owner.orgId);
    const actor = await c.login('member-invite-new-' + role, input.email);
    const me = await http('member-invite-dashboard-identity-' + role, actor, 'GET', '/api/auth/me', undefined, 200);
    assert.equal(me.data.data.user.membership.organization.type, 'COMPANY');
    assert.equal(me.data.data.user.membership.status, 'ACTIVE');
    assert.ok(!JSON.stringify(me.data).includes('inviteCode'));
    await http('member-invite-dashboard-read-' + role, actor, 'GET', '/api/kiosks/summary', undefined, 200);
    await http('member-invite-role-gate-' + role, actor, 'GET', '/api/members/requests', undefined, role === 'ADMIN' ? 200 : 403);
    await http('member-invite-reuse-denied-' + role, null, 'POST', '/api/auth/join', registration(code), 404);
    check('member-invite-complete-' + role, true);
  }
  const rotated = await generate(owner, 'STAFF');
  const current = await generate(owner, 'MANAGER');
  await http('member-invite-rotated-code-denied', null, 'POST', '/api/auth/join', registration(rotated), 404);
  await http('member-invite-tampered-role-denied', null, 'POST', '/api/auth/join', registration('A.' + current.slice(2)), 404);
  await prisma.organization.update({ where: { id: owner.orgId }, data: { inviteCodeExpiresAt: new Date(0) } });
  await http('member-invite-expired-denied', null, 'POST', '/api/auth/join', registration(current), 400);
  await http('member-invite-empty-denied', null, 'POST', '/api/auth/join', registration(''), 400);
  // A valid-looking code on a Distributor must never admit a Company member.
  await prisma.organization.update({ where: { id: owner.orgId }, data: { inviteCode: null } });
  await prisma.organization.update({ where: { id: distributor.orgId }, data: { inviteCode: current, inviteCodeExpiresAt: null } });
  await http('member-invite-wrong-org-type-denied', null, 'POST', '/api/auth/join', registration(current), 403);
  const raceCode = await generate(owner, 'STAFF');
  const before = await prisma.user.count();
  const race = await Promise.all([0, 1].map(() => http('member-invite-concurrent', null, 'POST', '/api/auth/join', registration(raceCode))));
  assert.equal(race.filter(r => r.status === 201).length, 1);
  assert.equal(race.filter(r => [400, 404].includes(r.status)).length, 1);
  assert.equal(await prisma.user.count(), before + 1);
  check('member-invite-one-concurrent-consumer', true);
  const legacy = await c.invite(owner);
  const legacyJoin = await http('member-invite-legacy-approval-preserved', null, 'POST', '/api/auth/join', registration(legacy), 201);
  assert.equal(legacyJoin.data.data.membership.status, 'PENDING');
  assert.equal(legacyJoin.data.data.membership.role, null);
  const memberCode = await generate(owner, 'STAFF');
  await http('member-invite-cannot-register-distributor', owner, 'POST', '/api/auth/register', { ...c.registration('member-code-distributor'), inviteCode: memberCode }, 400);
  // Current remote schema lacks profile columns. This flow must not require them.
  await c.sql.query('ALTER TABLE "Organization" RENAME COLUMN "gstNumber" TO "test_gstNumber"');
  await c.sql.query('ALTER TABLE "Organization" RENAME COLUMN "isActive" TO "test_isActive"');
  try {
    const compatible = await generate(owner, 'STAFF');
    await http('member-invite-older-schema-register', null, 'POST', '/api/auth/join', registration(compatible), 201);
  } finally {
    await c.sql.query('ALTER TABLE "Organization" RENAME COLUMN "test_gstNumber" TO "gstNumber"');
    await c.sql.query('ALTER TABLE "Organization" RENAME COLUMN "test_isActive" TO "isActive"');
  }
}
