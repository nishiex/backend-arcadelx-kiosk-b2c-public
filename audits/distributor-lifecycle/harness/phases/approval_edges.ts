import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Audit additional decision paths, races and current deployment compatibility.
// Failed expectations are recorded without stopping the remaining checks.
export async function run(c: any) {
  assert.equal(c.auditUrl.hostname, 'localhost');
  assert.match(c.auditUrl.pathname, /^\/arcadelx_audit_\d+$/);
  const owner = await c.fixture('decision-owner', 'COMPANY');
  const admin = await c.fixture('decision-admin', 'COMPANY', owner.orgId, 'ADMIN');
  const distributor = await c.fixture('decision-distributor', 'DISTRIBUTOR');
  const distributorAdmin = await c.fixture('decision-distributor-admin', 'DISTRIBUTOR', distributor.orgId, 'ADMIN');
  const unrelated = await c.fixture('decision-unrelated', 'DISTRIBUTOR');
  const hit = (label: string, actor: any, method: string, route: string, body?: any, expected: number | number[] = 200) =>
    c.http(`decision-${label}`, actor, method, route, body, expected);
  const check = (label: string, pass: boolean, details = {}) => c.check(`decision-${label}`, pass, details);
  const member = async (label: string) => {
    const actor = await c.fixture(`decision-${label}`, 'COMPANY', owner.orgId, 'STAFF', 'PENDING');
    return c.prisma.membership.update({ where: { userId: actor.userId }, data: { role: null } });
  };
  const decide = (label: string, actor: any, id: string, action: string, role?: string, expected: number | number[] = 200) =>
    hit(label, actor, 'POST', `/api/members/requests/${id}`, { action, ...(role ? { role } : {}) }, expected);

  for (const [actor, role] of [[owner, 'ADMIN'], [owner, 'MANAGER'], [owner, 'STAFF'], [admin, 'MANAGER'], [admin, 'STAFF']] as const) {
    const row = await member(`${actor.role.toLowerCase()}-grants-${role.toLowerCase()}`);
    await decide(`role-matrix-${actor.role}-${role}`, actor, row.id, 'APPROVE', role);
    const after = await c.prisma.membership.findUniqueOrThrow({ where: { id: row.id } });
    check(`role-matrix-${actor.role}-${role}-stored`, after.status === 'ACTIVE' && after.role === role);
  }
  await decide('invalid-request-id', owner, 'not-a-member', 'REJECT', undefined, 400);
  for (const actor of [owner, admin]) {
    const row = await member(`${actor.role.toLowerCase()}-rejects`);
    await decide(`${actor.role}-reject`, actor, row.id, 'REJECT');
    const after = await c.prisma.membership.findUniqueOrThrow({ where: { id: row.id } });
    check(`${actor.role}-rejection-stored`, after.status === 'REJECTED');
  }

  // Hold only a test membership row until both requests reach their DB writes.
  // This makes simultaneous decisions deterministic, not timing dependent.
  for (const [label, actions] of [
    ['approve-approve', [['APPROVE', 'STAFF'], ['APPROVE', 'MANAGER']]],
    ['reject-reject', [['REJECT', undefined], ['REJECT', undefined]]],
    ['approve-reject', [['APPROVE', 'STAFF'], ['REJECT', undefined]]],
  ] as const) {
    const row = await member(`race-${label}`);
    const blocker = new pg.Client({ connectionString: c.auditUrl.href, application_name: 'member_decision_barrier' });
    await blocker.connect();
    let pending: Promise<any>[] = [];
    let waiting = 0;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM "Membership" WHERE id=$1 FOR UPDATE', [row.id]);
      pending = actions.map(([action, role], i) => decide(`race-${label}-${i}`, i ? admin : owner, row.id, action, role, [200, 400, 409]));
      const deadline = Date.now() + 5000;
      do {
        waiting = Number((await c.sql.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name<>'member_decision_barrier'")).rows[0].count);
        if (waiting >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
    } finally {
      await blocker.query('COMMIT');
      await blocker.end();
    }
    const results = await Promise.all(pending);
    const stored = await c.prisma.membership.findUniqueOrThrow({ where: { id: row.id } });
    check(`race-${label}-overlap-confirmed`, waiting >= 2, { waiting });
    check(`race-${label}-one-winner`, results.filter(r => r.status === 200).length === 1, {
      statuses: results.map(r => r.status), storedStatus: stored.status, storedRole: stored.role,
      expected: 'Exactly one decision succeeds; the other reports an already processed request.',
    });
  }

  const pendingConnection = (await hit('network-initiate', owner, 'POST', '/api/network/initiate', { targetOwnerEmail: distributor.email }, 201)).data.data.connection;
  for (const actor of [owner, unrelated]) await hit(`network-wrong-receiver-${actor.label}`, actor, 'POST', `/api/network/${pendingConnection.id}/accept`, undefined, 404);
  const incoming = (await hit('network-pending-list', distributorAdmin, 'GET', '/api/network/requests')).data.data;
  check('network-pending-visible-to-recipient', incoming.data.some((row: any) => row.id === pendingConnection.id));
  const rejectRecipient = await c.fixture('decision-reject-recipient', 'DISTRIBUTOR');
  const rejectedNetwork = (await hit('network-to-reject', owner, 'POST', '/api/network/initiate', { targetOwnerEmail: rejectRecipient.email }, 201)).data.data.connection;
  await hit('network-reject', rejectRecipient, 'POST', `/api/network/${rejectedNetwork.id}/reject`);
  check('network-rejected-history-retained', (await c.prisma.networkConnection.findUniqueOrThrow({ where: { id: rejectedNetwork.id } })).status === 'REJECTED');
  await hit('network-cannot-accept-rejected', rejectRecipient, 'POST', `/api/network/${rejectedNetwork.id}/accept`, undefined, 404);
  await hit('network-cannot-delete-rejected-history', owner, 'DELETE', `/api/network/${rejectedNetwork.id}`, undefined, 409);
  await hit('network-recipient-cannot-use-delete-as-rejection', distributor, 'DELETE', `/api/network/${pendingConnection.id}`, undefined, 404);
  await hit('network-recipient-admin-accepts', distributorAdmin, 'POST', `/api/network/${pendingConnection.id}/accept`);
  const afterAccept = (await hit('network-pending-after-accept', distributorAdmin, 'GET', '/api/network/requests')).data.data;
  check('network-accept-removes-pending-request', !afterAccept.data.some((row: any) => row.id === pendingConnection.id));

  const rejectedAgreement = (await hit('agreement-to-reject', owner, 'POST', '/api/agreements/create', c.terms(pendingConnection.id, distributor.orgId), 201)).data.data.agreement;
  await hit('agreement-reject', distributor, 'PATCH', `/api/agreements/${rejectedAgreement.id}/reject`);
  check('agreement-rejected-history-retained', (await c.prisma.agreement.findUniqueOrThrow({ where: { id: rejectedAgreement.id } })).status === 'REJECTED');
  await hit('agreement-cannot-approve-rejected', distributor, 'PATCH', `/api/agreements/${rejectedAgreement.id}/approve`, undefined, 404);
  const agreement = (await hit('agreement-draft', owner, 'POST', '/api/agreements/create', c.terms(pendingConnection.id, distributor.orgId), 201)).data.data.agreement;
  await hit('agreement-child-cannot-terminate-pending', distributor, 'DELETE', `/api/agreements/${agreement.id}/terminate`, undefined, 404);
  await hit('agreement-parent-cannot-terminate-pending', owner, 'DELETE', `/api/agreements/${agreement.id}/terminate`, undefined, 404);
  check('agreement-still-pending', (await c.prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } })).status === 'PENDING_APPROVAL');
  await hit('agreement-recipient-admin-denied', distributorAdmin, 'PATCH', `/api/agreements/${agreement.id}/approve`, undefined, 403);
  await hit('agreement-recipient-owner-approves', distributor, 'PATCH', `/api/agreements/${agreement.id}/approve`);
  await hit('agreement-terminate-active', owner, 'DELETE', `/api/agreements/${agreement.id}/terminate`);
  await hit('agreement-cannot-reapprove-terminated', distributor, 'PATCH', `/api/agreements/${agreement.id}/approve`, undefined, 404);
  check('agreement-history-retained', (await c.prisma.agreement.findUniqueOrThrow({ where: { id: agreement.id } })).status === 'TERMINATED');
  const replacement = (await hit('agreement-replacement-draft', owner, 'POST', '/api/agreements/create', c.terms(pendingConnection.id, distributor.orgId), 201)).data.data.agreement;
  await hit('agreement-replacement-approve', distributor, 'PATCH', `/api/agreements/${replacement.id}/approve`);

  const rejectedOrder = await c.order('decision-rejected-request', distributor, 'REQUEST', owner, 1);
  await hit('order-reject', admin, 'PATCH', `/api/orders/${rejectedOrder.id}/reject`);
  check('order-rejection-retains-history', (await c.prisma.order.findUniqueOrThrow({ where: { id: rejectedOrder.id } })).status === 'REJECTED');
  await hit('order-cannot-approve-rejected', owner, 'PATCH', `/api/orders/${rejectedOrder.id}/approve`, undefined, 400);
  const order = await c.order('decision-stockless-request', distributor, 'REQUEST', owner, 1);
  const beforeStockless = await c.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  await hit('order-approval-insufficient-stock', admin, 'PATCH', `/api/orders/${order.id}/approve`, undefined, 409);
  assert.deepEqual(await c.prisma.order.findUniqueOrThrow({ where: { id: order.id } }), beforeStockless);
  check('failed-order-approval-rolls-back', await c.prisma.orderKiosk.count({ where: { orderId: order.id } }) === 0);
  await hit('order-add-stock', owner, 'POST', '/api/kiosks/batch', { count: 1, model: 'Approval audit' }, 201);
  await hit('order-approval-retry-after-stock', admin, 'PATCH', `/api/orders/${order.id}/approve`);
  const afterStock = await c.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  check('order-retry-commits-approval', afterStock.status === 'APPROVED' && await c.prisma.orderKiosk.count({ where: { orderId: order.id } }) === 1);

  // Reproduce observed configured-schema gaps locally, never alter Supabase.
  const evidence = JSON.parse(fs.readFileSync(path.join(c.outDir, 'evidence.json'), 'utf8'));
  const configured = evidence.find((row: any) => row.id === 'configured-database-schema-readonly');
  const columns = configured?.columns.filter((row: any) => row.table_name === 'Organization').map((row: any) => row.column_name);
  const missingProfile = columns ? ['gstNumber', 'phone', 'country'].filter(name => !columns.includes(name)) : [];
  if (missingProfile.length) {
    const existingPending = await member('compat-existing');
    const existingReject = await member('compat-reject');
    const compatConnection = (await hit('compat-network-prepare', owner, 'POST', '/api/network/initiate', { targetOwnerEmail: unrelated.email }, 201)).data.data.connection;
    await hit('compat-order-stock-prepare', owner, 'POST', '/api/kiosks/batch', { count: 1, model: 'Schema compatibility stock' }, 201);
    const compatOrder = await c.order('decision-compat-request', distributor, 'REQUEST', owner, 1);
    const compatOrderBefore = await c.prisma.order.findUniqueOrThrow({ where: { id: compatOrder.id } });
    const inviteCode = await c.invite(owner);
    const absentTables = ['EmailDelivery', 'OrderSequence'].filter(table => !configured.columns.some((row: any) => row.table_name === table));
    const missingReservation = !configured.columns.some((row: any) => row.table_name === 'Kiosk' && row.column_name === 'reservedOrderId');
    const gaps: [string, string][] = missingProfile.map(name => ['Organization', name]);
    if (missingReservation) gaps.push(['Kiosk', 'reservedOrderId']);
    const renamed: [string, string][] = [];
    const renamedTables: string[] = [];
    let compatOrderResult: any;
    try {
      for (const [table, name] of gaps) {
        await c.sql.query(`ALTER TABLE "${table}" RENAME COLUMN "${name}" TO "audit_${name}"`);
        renamed.push([table, name]);
      }
      for (const table of absentTables) {
        await c.sql.query(`ALTER TABLE "${table}" RENAME TO "audit_${table}"`);
        renamedTables.push(table);
      }
      c.record('decision-configured-schema-simulation', { missingProfile, missingReservation, absentTables, scope: 'Fresh local database only; observed missing columns/tables reproduced, not a full database clone' });
      const response = await hit('configured-schema-join', null, 'POST', '/api/auth/join', {
        name: 'Compatibility applicant', email: 'decision-compat-join@example.invalid', password: c.password, inviteCode,
      }, 201);
      check('configured-schema-new-user-can-request-membership', response.status === 201, { actualStatus: response.status });
      await hit('configured-schema-existing-pending-list', owner, 'GET', '/api/members/requests?page=1&limit=50');
      await decide('configured-schema-existing-member-approve', owner, existingPending.id, 'APPROVE', 'STAFF');
      check('configured-schema-existing-approval-persists', (await c.prisma.membership.findUniqueOrThrow({ where: { id: existingPending.id } })).status === 'ACTIVE');
      await decide('configured-schema-existing-member-reject', admin, existingReject.id, 'REJECT');
      check('configured-schema-existing-rejection-persists', (await c.prisma.membership.findUniqueOrThrow({ where: { id: existingReject.id } })).status === 'REJECTED');
      await hit('configured-schema-network-accept', unrelated, 'POST', `/api/network/${compatConnection.id}/accept`);
      const compatAgreementResult = await hit('configured-schema-agreement-create', owner, 'POST', '/api/agreements/create', c.terms(compatConnection.id, unrelated.orgId), 201);
      if (compatAgreementResult.status === 201) {
        const compatAgreement = compatAgreementResult.data.data.agreement;
        await hit('configured-schema-agreement-approve', unrelated, 'PATCH', `/api/agreements/${compatAgreement.id}/approve`);
        check('configured-schema-agreement-active', (await c.prisma.agreement.findUniqueOrThrow({ where: { id: compatAgreement.id } })).status === 'ACTIVE');
      }
      const capability = await hit('configured-schema-readiness', owner, 'GET', '/api/workflows');
      check('configured-schema-order-controls-disabled', capability.data.data.orderDecisions === false);
      compatOrderResult = await hit('configured-schema-order-approve', owner, 'PATCH', `/api/orders/${compatOrder.id}/approve`, undefined, 503);
      check('configured-schema-order-fails-cleanly-until-reconciled', compatOrderResult.status === 503, { actualStatus: compatOrderResult.status, deploymentStillBlocked: true });
    } finally {
      for (const [table, name] of renamed) await c.sql.query(`ALTER TABLE "${table}" RENAME COLUMN "audit_${name}" TO "${name}"`);
      for (const table of renamedTables) await c.sql.query(`ALTER TABLE "audit_${table}" RENAME TO "${table}"`);
    }
    if (compatOrderResult?.status !== 200) {
      assert.deepEqual(await c.prisma.order.findUniqueOrThrow({ where: { id: compatOrder.id } }), compatOrderBefore);
      check('configured-schema-failed-order-approval-retains-pending-order', true);
    }
  } else {
    c.record('decision-configured-schema-simulation-skipped', { reason: columns ? 'No observed Organization profile-column gap' : 'Configured metadata unavailable' });
  }
}
