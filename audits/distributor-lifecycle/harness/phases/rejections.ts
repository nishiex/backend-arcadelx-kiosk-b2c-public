import assert from 'node:assert/strict';
import pg from 'pg';

export async function run(c: any) {
  assert.equal(c.auditUrl.hostname, 'localhost');
  assert.match(c.auditUrl.pathname, /^\/arcadelx_audit_\d+$/);
  const co = await c.fixture('reject-company', 'COMPANY');
  const ca = await c.fixture('reject-company-admin', 'COMPANY', co.orgId, 'ADMIN');
  const d = await c.fixture('reject-distributor', 'DISTRIBUTOR');
  const da = await c.fixture('reject-distributor-admin', 'DISTRIBUTOR', d.orgId, 'ADMIN');
  const other = await c.fixture('reject-other', 'DISTRIBUTOR');
  const lower = [];
  for (const actor of [co, d]) for (const role of ['MANAGER', 'STAFF']) lower.push(await c.fixture(`${actor.label}-${role}`, actor.type, actor.orgId, role));
  const pending = await c.fixture('reject-pending', 'COMPANY', co.orgId, 'STAFF', 'PENDING');
  const rejected = await c.fixture('reject-rejected', 'COMPANY', co.orgId, 'STAFF', 'REJECTED');
  const hit = async (name: string, actor: any, method: string, route: string, body?: unknown, expected: number | number[] = 200) => {
    const result = await c.http(`rejections-${name}`, actor, method, route, body, expected);
    assert.ok((Array.isArray(expected) ? expected : [expected]).includes(result.status), `${name}: ${result.status}`);
    return result;
  };
  const check = (name: string, pass: boolean, extra = {}) => { c.check(`rejections-${name}`, pass, extra); assert.ok(pass, name); };
  async function overlap(name: string, query: string, args: any[], calls: (() => Promise<any>)[]) {
    const lock = new pg.Client({ connectionString: c.auditUrl.href, application_name: 'rejection_barrier' });
    await lock.connect();
    let waiting = 0;
    let requests: Promise<any>[] = [];
    try {
      await lock.query('BEGIN'); await lock.query(query, args);
      requests = calls.map(fn => fn());
      const deadline = Date.now() + 5000;
      do {
        waiting = Number((await c.sql.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name<>'rejection_barrier'")).rows[0].count);
        if (waiting >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
    } finally { await lock.query('COMMIT'); await lock.end(); }
    const results = await Promise.all(requests);
    check(`${name}-overlap`, waiting >= 2);
    check(`${name}-one-winner`, results.filter(result => result.status === 200).length === 1, { statuses: results.map(result => result.status) });
  }
  const nc = (await hit('network-initiate', co, 'POST', '/api/network/initiate', { targetOwnerEmail: d.email }, 201)).data.data.connection;
  for (const actor of [null, ...lower, pending, rejected]) {
    await hit(`network-deny-${actor?.label}`, actor, 'POST', `/api/network/${nc.id}/reject`, undefined, actor ? 403 : 401);
  }
  for (const actor of [co, other]) await hit(`network-wrong-org-${actor.label}`, actor, 'POST', `/api/network/${nc.id}/reject`, undefined, 404);
  await overlap('network-accept-reject', 'SELECT id FROM "NetworkConnection" WHERE id=$1 FOR UPDATE', [nc.id], [
    () => hit('network-race-accept', d, 'POST', `/api/network/${nc.id}/accept`, undefined, [200, 404]),
    () => hit('network-race-reject', da, 'POST', `/api/network/${nc.id}/reject`, undefined, [200, 404]),
  ]);
  const nr = await c.prisma.networkConnection.findUniqueOrThrow({ where: { id: nc.id } });
  check('network-retains-original-parties', nr.initiatorOrgId === co.orgId && nr.receiverOrgId === d.orgId);
  for (const actor of [co, d]) {
    const rows = (await hit(`network-history-${actor.label}`, actor, 'GET', '/api/network?page=1&limit=20')).data.data.requests;
    check(`network-history-visible-${actor.label}`, rows.some((r: any) => r.id === nc.id && r.status === nr.status));
  }
  check('network-history-scoped', (await hit('network-history-unrelated', other, 'GET', '/api/network')).data.data.requests.length === 0);

  // Independent active relationship so the race winner cannot affect later tests.
  const recipient = await c.fixture('reject-agreement-recipient', 'DISTRIBUTOR');
  const ra = await c.fixture('reject-agreement-admin', 'DISTRIBUTOR', recipient.orgId, 'ADMIN');
  const network = await c.connect('reject-agreement-network', co, recipient);
  const draft = (await hit('agreement-create', co, 'POST', '/api/agreements/create', c.terms(network.id, recipient.orgId), 201)).data.data.agreement;
  for (const actor of [null, ...lower, pending, rejected, ra]) await hit(`agreement-deny-${actor?.label}`, actor, 'PATCH', `/api/agreements/${draft.id}/reject`, undefined, actor ? 403 : 401);
  for (const actor of [co, other]) await hit(`agreement-wrong-org-${actor.label}`, actor, 'PATCH', `/api/agreements/${draft.id}/reject`, undefined, 404);
  await overlap('agreement-approve-reject', 'SELECT id FROM "Organization" WHERE id=$1 FOR UPDATE', [recipient.orgId], [
    () => hit('agreement-race-approve', recipient, 'PATCH', `/api/agreements/${draft.id}/approve`, undefined, [200, 404]),
    () => hit('agreement-race-reject', recipient, 'PATCH', `/api/agreements/${draft.id}/reject`, undefined, [200, 404]),
  ]);
  const ar = await c.prisma.agreement.findUniqueOrThrow({ where: { id: draft.id } });
  check('agreement-retains-financial-terms', ar.depositAmountPerMachine === 1000 && ar.nonRefundableAmountPerMachine === 200 && Number(ar.parentSharePct) === 60);
  for (const actor of [co, recipient]) check(`agreement-history-${actor.label}`, (await hit(`agreement-history-${actor.label}`, actor, 'GET', '/api/agreements')).data.data.agreements.some((row: any) => row.id === draft.id));
  check('agreement-history-scoped', (await hit('agreement-history-unrelated', other, 'GET', '/api/agreements')).data.data.agreements.length === 0);
  if (ar.status === 'REJECTED') await c.agreement('reject-active-replacement', co, recipient, network);
  await hit('mint', co, 'POST', '/api/kiosks/batch', { count: 4, model: 'Rejection regression' }, 201);
  const request = await c.order('reject-order-request', recipient, 'REQUEST', co);
  for (const actor of [null, ...lower, pending, rejected]) await hit(`order-deny-${actor?.label}`, actor, 'PATCH', `/api/orders/${request.id}/reject`, undefined, actor ? 403 : 401);
  for (const actor of [recipient, other]) await hit(`order-wrong-org-${actor.label}`, actor, 'PATCH', `/api/orders/${request.id}/reject`, undefined, 403);
  const stockBefore = await c.prisma.kiosk.findMany({ orderBy: { id: 'asc' } });
  await hit('order-admin-reject', ca, 'PATCH', `/api/orders/${request.id}/reject`);
  assert.deepEqual(await c.prisma.kiosk.findMany({ orderBy: { id: 'asc' } }), stockBefore);
  check('order-rejection-does-not-touch-stock', await c.prisma.orderKiosk.count({ where: { orderId: request.id } }) === 0);
  const saved = await c.prisma.order.findUniqueOrThrow({ where: { id: request.id } });
  check('order-rejection-retains-financial-snapshot', saved.status === 'REJECTED' && saved.grandTotal === request.grandTotal && saved.paymentStatus === 'PENDING');
  await hit('order-repeat-reject', co, 'PATCH', `/api/orders/${request.id}/reject`, undefined, 409);
  const raceOrder = await c.order('reject-order-race', recipient, 'REQUEST', co);
  await overlap('order-approve-reject', 'SELECT id FROM "Order" WHERE id=$1 FOR UPDATE', [raceOrder.id], [
    () => hit('order-race-approve', co, 'PATCH', `/api/orders/${raceOrder.id}/approve`, undefined, [200, 400]),
    () => hit('order-race-reject', ca, 'PATCH', `/api/orders/${raceOrder.id}/reject`, undefined, [200, 409]),
  ]);
  const raced = await c.prisma.order.findUniqueOrThrow({ where: { id: raceOrder.id }, include: { dispatchedKiosks: true, reservedKiosks: true } });
  check('order-race-inventory-consistent', raced.status === 'REJECTED' ? raced.dispatchedKiosks.length === 0 && raced.reservedKiosks.length === 0 : raced.dispatchedKiosks.length === 1 && raced.reservedKiosks.length === 1);
  const allocation = await c.order('reject-allocation', co, 'ALLOCATION', recipient);
  const protectedStock = await c.prisma.kiosk.findMany({ orderBy: { id: 'asc' } });
  await hit('cannot-reject-approved-allocation', co, 'PATCH', `/api/orders/${allocation.id}/reject`, undefined, 409);
  assert.deepEqual(await c.prisma.kiosk.findMany({ orderBy: { id: 'asc' } }), protectedStock);
  await hit('allocation-pay', co, 'PATCH', `/api/orders/${allocation.id}/paid`);
  await hit('cannot-reject-paid-order', co, 'PATCH', `/api/orders/${allocation.id}/reject`, undefined, 409);
  await hit('allocation-dispatch', co, 'PATCH', `/api/orders/${allocation.id}/dispatch`);
  await hit('cannot-reject-dispatched-order', co, 'PATCH', `/api/orders/${allocation.id}/reject`, undefined, 409);
  await hit('allocation-deliver', co, 'PATCH', `/api/orders/${allocation.id}/deliver`);
  await hit('cannot-reject-delivered-order', co, 'PATCH', `/api/orders/${allocation.id}/reject`, undefined, 409);
  check('delivered-history-retained', (await c.prisma.order.findUniqueOrThrow({ where: { id: allocation.id } })).status === 'DELIVERED');

  // Missing enum migration must produce a controlled error before any mutation.
  for (const name of ['NetworkStatus', 'AgreementStatus']) await c.sql.query(`ALTER TYPE "${name}" RENAME VALUE 'REJECTED' TO 'AUDIT_REJECTED'`);
  try {
    const ready = (await hit('legacy-readiness', co, 'GET', '/api/workflows')).data.data;
    check('legacy-rejection-buttons-disabled', !ready.networkRejection && !ready.agreementRejection && ready.orderDecisions);
    await hit('legacy-network-reject-503', d, 'POST', `/api/network/${nc.id}/reject`, undefined, 503);
    await hit('legacy-agreement-reject-503', recipient, 'PATCH', `/api/agreements/${draft.id}/reject`, undefined, 503);
  } finally {
    for (const name of ['NetworkStatus', 'AgreementStatus']) await c.sql.query(`ALTER TYPE "${name}" RENAME VALUE 'AUDIT_REJECTED' TO 'REJECTED'`);
  }
}
