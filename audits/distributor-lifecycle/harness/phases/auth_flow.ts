import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// Run with AUDIT_PHASES=auth_flow in the existing isolated PostgreSQL harness.
// Credentials stay in memory; the harness redacts request secrets in evidence.
export async function run(c: any) {
  const { prisma, http, check } = c;
  const company = await c.fixture('auth-company', 'COMPANY');
  const counts = () => Promise.all([
    prisma.user.count(), prisma.organization.count(),
    prisma.membership.count(), prisma.emailDelivery.count(),
  ]);
  const credentials = (email: string) => {
    const mail = c.mails.findLast((m: any) => m.To[0].Email === email);
    const password = mail?.TextPart.match(/Temporary Password:\s*([^\s]+)/)?.[1];
    assert.ok(password, 'credentials delivered to the new owner');
    assert.ok(mail.TextPart.includes(process.env.FRONTEND_LOGIN_URL));
    return password as string;
  };
  const register = async (label: string, parent: any, type: string, send = true) => {
    const input = { ...c.registration(label, type),
      ...(type === 'DISTRIBUTOR' ? { inviteCode: await c.invite(parent) } : {}) };
    const before = await counts();
    const response = await http(label, parent, 'POST', '/api/auth/register', input, 201);
    assert.equal(response.status, 201);
    assert.equal(response.cookies, '', 'registration preserves creator session');
    assert.deepEqual(await counts(), before.map((n: number) => n + 1));
    assert.equal(response.data.data.credentialsEmailSent, send);
    assert.deepEqual(Object.keys(response.data.data.owner).sort(), ['contact', 'email', 'id', 'name']);
    assert.equal(response.data.data.owner.contact, input.ownerContact);
    assert.ok(!/password|passwordHash/i.test(JSON.stringify(response.data)));
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: input.ownerEmail }, include: { membership: true },
    });
    assert.equal(owner.membership.role, 'OWNER');
    assert.equal(owner.membership.status, 'ACTIVE');
    assert.equal(owner.membership.organizationId, response.data.data.organization.id);
    const job = await prisma.emailDelivery.findUniqueOrThrow({
      where: { key: `organization:${owner.membership.organizationId}:credentials` },
    });
    assert.equal(job.ownerOrganizationId, parent.orgId);
    if (send) {
      const password = credentials(input.ownerEmail);
      assert.ok(await bcrypt.compare(password, owner.passwordHash), 'emailed password matches bcrypt hash');
      assert.ok(!JSON.stringify(response.data).includes(password));
      assert.equal(job.payload, '', 'sent credentials erased from queue');
      assert.ok(job.sentAt);
      check(`${label}-secure-registration`, true);
      return c.login(label, owner.email, password);
    }
    assert.equal(job.sentAt, null);
    assert.equal(job.payload.split('.').length, 3, 'pending credentials are authenticated encrypted');
    return { email: owner.email, orgId: owner.membership.organizationId, userId: owner.id };
  };
  const distributor = await register('auth-distributor', company, 'DISTRIBUTOR');
  const partner = await register('auth-partner', distributor, 'PARTNER');
  for (const actor of [company, distributor, partner]) {
    const me = await http(`auth-identity-${actor.type}`, actor, 'GET', '/api/auth/me', undefined, 200);
    assert.equal(me.data.data.user.id, actor.userId);
    assert.equal(me.data.data.user.membership.organization.type, actor.type);
  }
  const admin = await c.fixture('auth-distributor-admin', 'DISTRIBUTOR', distributor.orgId, 'ADMIN');
  await register('auth-admin-partner', admin, 'PARTNER');
  const deny = async (label: string, actor: any, type = 'PARTNER', status = 403) => {
    const before = await counts();
    const response = await http(label, actor, 'POST', '/api/auth/register', {
      ...c.registration(label, type), inviteCode: 'forged', role: 'OWNER',
      organizationId: company.orgId, parentOrgType: 'COMPANY',
    }, status);
    assert.equal(response.status, status);
    assert.deepEqual(await counts(), before, 'denied request creates no records');
  };
  await deny('auth-anonymous-denied', null, 'PARTNER', 401);
  await deny('auth-distributor-cannot-register-distributor', distributor, 'DISTRIBUTOR');
  await deny('auth-partner-cannot-register', partner);
  for (const role of ['MANAGER', 'STAFF']) {
    const actor = await c.fixture(`auth-distributor-${role}`, 'DISTRIBUTOR', distributor.orgId, role);
    await deny(`auth-${role}-denied`, actor);
  }
  for (const status of ['PENDING', 'REJECTED']) {
    const actor = await c.fixture(`auth-distributor-${status}`, 'DISTRIBUTOR', distributor.orgId, 'ADMIN', status);
    await deny(`auth-${status}-denied`, actor);
  }
  for (const [method, route, body] of [
    ['POST', '/api/members/generateInviteCode', undefined],
    ['GET', '/api/members/requests', undefined],
    ['GET', '/api/network/distributors', undefined],
    ['POST', '/api/kiosks/batch', { count: 1, model: 'Forbidden' }],
    ['PATCH', `/api/network/distributors/${distributor.orgId}/status`, { isActive: false }],
  ] as const) {
    const result = await http(`auth-company-only-${route}`, distributor, method, route, body, 403);
    assert.equal(result.status, 403);
  }
  c.setFailMail(true);
  let pending: any;
  try { pending = await register('auth-email-recovery', distributor, 'PARTNER', false); }
  finally { c.setFailMail(false); }
  const retryRoute = `/api/auth/organizations/${pending.orgId}/credentials/retry`;
  assert.equal((await http('auth-cross-org-retry-denied', company, 'POST', retryRoute, undefined, 404)).status, 404);
  const beforeRetry = await counts();
  assert.equal((await http('auth-owner-retry', distributor, 'POST', retryRoute, undefined, 200)).data.data.credentialsEmailSent, true);
  const sent = c.mails.length;
  await http('auth-owner-repeat-retry', distributor, 'POST', retryRoute, undefined, 200);
  assert.equal(c.mails.length, sent, 'retry does not resend delivered credentials');
  assert.deepEqual(await counts(), beforeRetry, 'retry does not duplicate registration');
  await c.login('auth-recovered-partner', pending.email, credentials(pending.email));
  const oldPassword = credentials(partner.email);
  const newPassword = crypto.randomBytes(24).toString('base64url');
  const refresh = await http('auth-partner-refresh', partner, 'POST', '/api/auth/refresh', undefined, 200);
  assert.equal(refresh.status, 200);
  const refreshed = { ...partner, cookie: refresh.cookies };
  await http('auth-partner-password-change', refreshed, 'POST', '/api/auth/change-password', {
    email: partner.email, currentPassword: oldPassword, newPassword, confirmPassword: newPassword,
  }, 200);
  assert.equal(await prisma.refreshToken.count({ where: { userId: partner.userId } }), 0);
  await http('auth-old-password-denied', null, 'POST', '/api/auth/login', { email: partner.email, password: oldPassword }, 401);
  await http('auth-old-session-refresh-denied', refreshed, 'POST', '/api/auth/refresh', undefined, 401);
  const changed = await c.login('auth-changed-partner', partner.email, newPassword);
  await http('auth-partner-logout', changed, 'POST', '/api/auth/refresh/logout', undefined, 200);
  await http('auth-logged-out-refresh-denied', changed, 'POST', '/api/auth/refresh', undefined, 401);
  check('auth-complete-chain-and-session-regression', true);
}
