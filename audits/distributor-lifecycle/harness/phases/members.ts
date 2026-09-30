import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Run with AUDIT_PHASES=members using the existing isolated PostgreSQL harness.
// No requests or mutations target the configured running application's database.
export async function run(c: any) {
  assert.equal(c.auditUrl.hostname, 'localhost');
  assert.match(c.auditUrl.pathname, /^\/arcadelx_audit_\d+$/);
  const owner = await c.fixture('members-owner', 'COMPANY');
  const admin = await c.fixture('members-admin', 'COMPANY', owner.orgId, 'ADMIN');
  const manager = await c.fixture('members-manager', 'COMPANY', owner.orgId, 'MANAGER');
  const staff = await c.fixture('members-staff', 'COMPANY', owner.orgId, 'STAFF');
  const distributor = await c.fixture('members-distributor', 'DISTRIBUTOR');
  const outsider = await c.fixture('members-other-pending', 'DISTRIBUTOR', distributor.orgId, 'STAFF', 'PENDING');
  const requestsPath = '/api/members/requests';
  const hit = async (label: string, actor: any, method: string, route: string, body?: unknown, expected = 200) => {
    const result = await c.http(`members-${label}`, actor, method, route, body, expected);
    assert.equal(result.status, expected, label);
    return result.data.data;
  };
  const membership = (userId: string) => c.prisma.membership.findUniqueOrThrow({ where: { userId } });
  const pending = (actor = owner, suffix = '?page=1&limit=50') => hit('pending-list', actor, 'GET', requestsPath + suffix);
  const mutate = (label: string, actor: any, id: string, body: unknown, expected = 200) =>
    hit(label, actor, 'POST', `${requestsPath}/${id}`, body, expected);
  const check = (label: string, condition: boolean) => {
    c.check(`members-${label}`, condition);
    assert.ok(condition, label);
  };

  check('starts-empty', (await pending()).meta.total === 0);
  const inviteCode = await c.invite(owner);
  const join = async (label: string) => {
    const result = await hit(`join-${label}`, null, 'POST', '/api/auth/join', {
      name: `Member ${label}`, email: `members-${label}@example.invalid`,
      password: c.password, inviteCode,
    }, 201);
    const row = await membership(result.user.id);
    check(`join-${label}-pending-with-no-role`, row.status === 'PENDING' && row.role === null);
    return { userId: result.user.id, id: row.id };
  };
  const toApprove = await join('approve');
  const toReject = await join('reject');
  const forAdmin = await join('admin-approval');
  const elevated = await join('elevated');
  const list = await pending();
  const expectedIds = [toApprove.id, toReject.id, forAdmin.id, elevated.id].sort();
  assert.deepEqual(list.data.map((row: any) => row.id).sort(), expectedIds);
  assert.deepEqual(list.meta, { total: 4, page: 1, limit: 50, totalPages: 1 });
  check('list-only-company-pending-members-with-safe-user-fields', list.data.every((row: any) =>
    row.organizationId === owner.orgId && row.status === 'PENDING' &&
    row.user.name && row.user.email && !('passwordHash' in row.user)));
  check('admin-can-list-same-requests', (await pending(admin)).meta.total === 4);

  const first = await pending(owner, '?page=1&limit=2');
  const second = await pending(owner, '?page=2&limit=2');
  check('api-pagination-covers-all-requests', first.meta.totalPages === 2 &&
    new Set([...first.data, ...second.data].map((row: any) => row.id)).size === 4);

  const pendingActor = await c.login('members-pending-login', 'members-approve@example.invalid');
  for (const [label, actor, status] of [
    ['anonymous', null, 401], ['manager', manager, 403], ['staff', staff, 403],
    ['distributor', distributor, 403], ['pending-member', pendingActor, 403],
  ] as const) {
    const before = await membership(toApprove.userId);
    await hit(`deny-${label}-list`, actor, 'GET', requestsPath, undefined, status);
    for (const action of ['APPROVE', 'REJECT']) {
      await mutate(`deny-${label}-${action}`, actor, toApprove.id, { action, role: 'STAFF' }, status);
    }
    assert.deepEqual(await membership(toApprove.userId), before);
    check(`deny-${label}-preserves-request`, true);
  }

  const outsiderBefore = await membership(outsider.userId);
  await mutate('deny-cross-organization', owner, outsiderBefore.id, { action: 'APPROVE', role: 'STAFF' }, 400);
  assert.deepEqual(await membership(outsider.userId), outsiderBefore);
  check('cross-organization-request-unchanged', true);

  for (const [label, actor, body, status] of [
    ['missing-role', owner, { action: 'APPROVE' }, 400],
    ['invalid-role', owner, { action: 'APPROVE', role: 'OWNER' }, 400],
    ['invalid-action', owner, { action: 'DELETE' }, 400],
    ['admin-cannot-grant-admin', admin, { action: 'APPROVE', role: 'ADMIN' }, 403],
  ] as const) {
    const before = await membership(toApprove.userId);
    await mutate(label, actor, toApprove.id, body, status);
    assert.deepEqual(await membership(toApprove.userId), before);
    check(`${label}-preserves-request`, true);
  }

  await mutate('approve-manager', owner, toApprove.id, { action: 'APPROVE', role: 'MANAGER' });
  let row = await membership(toApprove.userId);
  check('approval-persists-active-selected-role', row.status === 'ACTIVE' && row.role === 'MANAGER');
  let remaining = await pending();
  check('approval-removes-request-and-updates-count', remaining.meta.total === 3 &&
    remaining.data.every((r: any) => r.id !== toApprove.id));
  const me = await hit('approved-member-identity', pendingActor, 'GET', '/api/auth/me');
  check('approved-user-sees-active-membership', me.user.membership.status === 'ACTIVE' &&
    me.user.membership.role === 'MANAGER');
  await hit('approved-user-can-access-inventory', pendingActor, 'GET', '/api/kiosks');
  const activeBefore = await membership(toApprove.userId);
  await mutate('duplicate-approval-denied', owner, toApprove.id, { action: 'APPROVE', role: 'STAFF' }, 400);
  await mutate('cannot-reject-active-member', owner, toApprove.id, { action: 'REJECT' }, 400);
  assert.deepEqual(await membership(toApprove.userId), activeBefore);
  check('repeated-action-preserves-active-role', true);

  const rejectUserBefore = await c.prisma.user.findUniqueOrThrow({ where: { id: toReject.userId } });
  await mutate('reject-request', admin, toReject.id, { action: 'REJECT' });
  row = await membership(toReject.userId);
  check('rejection-persists-without-deleting-user', row.status === 'REJECTED' && row.role === null);
  assert.deepEqual(await c.prisma.user.findUniqueOrThrow({ where: { id: toReject.userId } }), rejectUserBefore);
  remaining = await pending();
  check('rejection-removes-request-and-updates-count', remaining.meta.total === 2 &&
    remaining.data.every((r: any) => r.id !== toReject.id));
  const rejectedActor = await c.login('members-rejected-login', 'members-reject@example.invalid');
  await hit('rejected-user-no-inventory-access', rejectedActor, 'GET', '/api/kiosks', undefined, 403);
  await mutate('duplicate-rejection-denied', owner, toReject.id, { action: 'REJECT' }, 400);
  await mutate('cannot-approve-rejected-member', owner, toReject.id, { action: 'APPROVE', role: 'STAFF' }, 400);
  check('rejected-status-retained', (await membership(toReject.userId)).status === 'REJECTED');

  await mutate('admin-approves-staff', admin, forAdmin.id, { action: 'APPROVE', role: 'STAFF' });
  check('admin-can-grant-lower-role', (await membership(forAdmin.userId)).role === 'STAFF');
  await mutate('owner-approves-admin', owner, elevated.id, { action: 'APPROVE', role: 'ADMIN' });
  check('owner-can-grant-admin', (await membership(elevated.userId)).role === 'ADMIN');
  remaining = await pending();
  check('all-processed-shows-empty-list', remaining.meta.total === 0 && remaining.data.length === 0);
  check('dashboard-count-updated', (await pending(owner, '?page=1&limit=1')).meta.total === 0);
  check('no-email-sent', c.mails.length === 0);

  // More than one UI page, including equal creation timestamps, must be stable.
  const users = Array.from({ length: 55 }, (_, i) => ({ id: crypto.randomUUID(), name: `Pagination ${i}`, email: `pagination-${i}@example.invalid`, passwordHash: 'fixture-without-login' }));
  await c.prisma.user.createMany({ data: users });
  const sameTime = new Date();
  await c.prisma.membership.createMany({ data: users.map(user => ({ userId: user.id, organizationId: owner.orgId, status: 'PENDING', createdAt: sameTime })) });
  const pageOne = await pending();
  const pageTwo = await pending(owner, '?page=2&limit=50');
  check('pagination-55-requests-over-two-pages', pageOne.data.length === 50 && pageTwo.data.length === 5 && pageTwo.meta.total === 55 && pageTwo.meta.totalPages === 2);
  check('pagination-no-duplicates', new Set([...pageOne.data, ...pageTwo.data].map(row => row.id)).size === 55);
  assert.deepEqual((await pending()).data.map((row: any) => row.id), pageOne.data.map((row: any) => row.id));
  check('pagination-stable-with-tied-timestamps', true);
  for (const request of pageTwo.data) await mutate('process-last-page', owner, request.id, { action: 'REJECT' });
  const emptied = await pending(owner, '?page=2&limit=50');
  check('last-page-count-allows-ui-clamp', emptied.data.length === 0 && emptied.meta.total === 50 && emptied.meta.totalPages === 1);
}
