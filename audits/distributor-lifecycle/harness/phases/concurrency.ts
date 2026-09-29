import pg from 'pg';

export async function run(c: any) {
  const { http, prisma, sql, check, company: co, terms } = c;
  // Locks only audit DB rows/tables. No source monkey-patching: HTTP handlers execute real SQL.
  async function overlap(label: string, lock: string, params: any[], requests: (() => Promise<any>)[]) {
    const blocker = new pg.Client({ connectionString: c.auditUrl.href, application_name: 'audit_barrier' });
    await blocker.connect();
    await blocker.query('BEGIN');
    await blocker.query(lock, params);
    const pending = requests.map(fn => fn());
    let blocked = 0;
    try {
      const deadline = Date.now() + 2500;
      do {
        blocked = Number((await sql.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name <> 'audit_barrier'")).rows[0].count);
        if (blocked >= requests.length) break;
        await new Promise(r => setTimeout(r, 30));
      } while (Date.now() < deadline);
      c.record(`${label}-barrier`, { kind: 'concurrency barrier', lock, params, waitingRequests: blocked, expectedRequests: requests.length, synchronized: blocked >= requests.length });
    } finally {
      await blocker.query('COMMIT');
      await blocker.end();
    }
    const result = await Promise.all(pending);
    c.record(`${label}-outcome`, { kind: 'concurrency result', synchronized: blocked >= requests.length, statuses: result.map(x=>x.status) });
    return result;
  }
  const d1 = await c.register('race-distributor-one',co);
  const d2 = await c.register('race-distributor-two',co);
  const n1 = await c.connect('race-upstream-one',co,d1);
  const n2 = await c.connect('race-upstream-two',co,d2);
  await c.agreement('race-company-agreement-one',co,d1,n1);
  await c.agreement('race-company-agreement-two',co,d2,n2);
  await http('race-stock-mint',co,'POST','/api/kiosks/batch',{count:8,model:'Concurrency stock'},201);
  const r1 = await c.order('race-request-one',d1,'REQUEST',co);
  const r2 = await c.order('race-request-two',d2,'REQUEST',co);
  await overlap('two-reservations', 'SELECT id FROM "Kiosk" WHERE "currentOrgId"=$1 AND status=\'AVAILABLE\' FOR UPDATE', [co.orgId], [
    () => http('race-reserve-first',co,'PATCH',`/api/orders/${r1.id}/approve`),
    () => http('race-reserve-second',co,'PATCH',`/api/orders/${r2.id}/approve`),
  ]);
  const s1 = await c.snapshot('race-reserved-first-snapshot',r1.id);
  const s2 = await c.snapshot('race-reserved-second-snapshot',r2.id);
  const overlapIds = s1.dispatchedKiosks.filter((x:any)=>s2.dispatchedKiosks.some((y:any)=>x.kioskId===y.kioskId)).map((x:any)=>x.kioskId);
  check('concurrent-reservations-do-not-share-kiosk',overlapIds.length===0,{overlapIds,orders:[r1.id,r2.id]});
  // Demonstrate actual lost ownership using only API operations following the reservation race.
  if(overlapIds.length) {
    for(const row of [r1,r2]) await http(`shared-order-paid-${row.id}`,co,'PATCH',`/api/orders/${row.id}/paid`,undefined,200);
    await http('shared-order-dispatch-first',co,'PATCH',`/api/orders/${r1.id}/dispatch`,undefined,200);
    await http('shared-order-dispatch-second-blocked',co,'PATCH',`/api/orders/${r2.id}/dispatch`,undefined,400);
    await http('shared-in-transit-reset-reserved',co,'PATCH',`/api/kiosks/${overlapIds[0]}/status`,{status:'RESERVED'},400);
    await http('shared-order-dispatch-second-after-reset',co,'PATCH',`/api/orders/${r2.id}/dispatch`,undefined,400);
    await http('shared-order-deliver-first',co,'PATCH',`/api/orders/${r1.id}/deliver`,undefined,200);
    const before = await prisma.kiosk.findUnique({where:{id:overlapIds[0]}});
    await http('shared-order-deliver-second-overwrites-owner',co,'PATCH',`/api/orders/${r2.id}/deliver`,undefined,400);
    const after = await prisma.kiosk.findUnique({where:{id:overlapIds[0]}});
    check('delivery-preserves-owner-on-stale-order',before?.currentOrgId===after?.currentOrgId,{before,after});
  }
  const same = await c.order('race-same-order',d1,'REQUEST',co);
  await overlap('two-approvals-same-order','SELECT id FROM "Kiosk" WHERE "currentOrgId"=$1 AND status=\'AVAILABLE\' FOR UPDATE',[co.orgId],[
    () => http('same-order-approve-first',co,'PATCH',`/api/orders/${same.id}/approve`),
    () => http('same-order-approve-second',co,'PATCH',`/api/orders/${same.id}/approve`),
  ]);
  await c.snapshot('same-order-after-race',same.id);
  const created = await overlap('order-number-race','LOCK TABLE "Order" IN SHARE MODE',[],[
    () => http('order-number-first',d1,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1}),
    () => http('order-number-second',d1,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1}),
  ]);
  check('concurrent-new-orders-both-succeed',created.every(x=>x.status===201),{statuses:created.map(x=>x.status)});
  const repeatedBody = {type:'REQUEST',targetOrgId:co.orgId,quantity:1};
  const repeat1 = await http('duplicate-order-body-first',d1,'POST','/api/orders/create',repeatedBody,201);
  const repeat2 = await http('duplicate-order-body-second',d1,'POST','/api/orders/create',repeatedBody,201);
  c.record('order-retry-not-idempotent',{orders:[repeat1.data?.data?.order?.id,repeat2.data?.data?.order?.id]});

  const p = await c.register('race-partner',d1,'PARTNER');
  const connections = await overlap('duplicate-network-creation','LOCK TABLE "NetworkConnection" IN SHARE MODE',[],[
    () => http('duplicate-network-first',d1,'POST','/api/network/initiate',{targetOwnerEmail:p.email}),
    () => http('duplicate-network-second',d1,'POST','/api/network/initiate',{targetOwnerEmail:p.email}),
  ]);
  const count = await prisma.networkConnection.count({where:{initiatorOrgId:d1.orgId,receiverOrgId:p.orgId}});
  check('concurrent-network-pair-unique',count===1,{count});
  const connection = connections.find(x=>x.status===201).data.data.connection;
  await overlap('concurrent-connection-accept','SELECT id FROM "NetworkConnection" WHERE id=$1 FOR UPDATE',[connection.id],[
    () => http('accept-concurrent-first',p,'POST',`/api/network/${connection.id}/accept`),
    () => http('accept-concurrent-second',p,'POST',`/api/network/${connection.id}/accept`),
  ]);
  check('connection-race-final-active',(await prisma.networkConnection.findUnique({where:{id:connection.id}}))?.status==='ACTIVE');
  const agreements = await overlap('duplicate-agreement-creation','LOCK TABLE "Agreement" IN SHARE MODE',[],[
    () => http('agreement-race-create-first',d1,'POST','/api/agreements/create',terms(connection.id,p.orgId)),
    () => http('agreement-race-create-second',d1,'POST','/api/agreements/create',terms(connection.id,p.orgId)),
  ]);
  const a1 = agreements[0].data.data.agreement;
  const a2 = agreements[1].data.data.agreement;
  await overlap('concurrent-agreement-approval','SELECT id FROM "Agreement" WHERE id=$1 FOR UPDATE',[a1.id],[
    () => http('agreement-approve-concurrent-first',p,'PATCH',`/api/agreements/${a1.id}/approve`),
    () => http('agreement-approve-concurrent-second',p,'PATCH',`/api/agreements/${a1.id}/approve`),
  ]);
  await http('agreement-second-pending-can-activate',p,'PATCH',`/api/agreements/${a2.id}/approve`,undefined,409);
  const activeCount = await prisma.agreement.count({where:{childOrgId:p.orgId,status:'ACTIVE'}});
  check('concurrent-agreements-only-one-active',activeCount===1,{activeCount});

  // Isolated fixture models the ordinary pre-existing parent ledger row.
  // Delivery already proved through HTTP for real company-created stock in happy.ts.
  const kiosk = await prisma.kiosk.create({data:{machineCode:'AUDIT-RACE-DELIVERY',model:'Delivery concurrency fixture',currentOrgId:d1.orgId,status:'AVAILABLE'}});
  await prisma.kioskAssignment.create({data:{kioskId:kiosk.id,organizationId:d1.orgId,assignedById:d1.userId}});
  c.record('delivery-race-fixture',{kind:'direct DB fixture',kioskId:kiosk.id,organizationId:d1.orgId});
  const delivery = await c.order('delivery-race-allocation',d1,'ALLOCATION',p);
  await http('delivery-race-paid',d1,'PATCH',`/api/orders/${delivery.id}/paid`,undefined,200);
  await http('delivery-race-dispatch',d1,'PATCH',`/api/orders/${delivery.id}/dispatch`,undefined,200);
  const deliveryResults = await overlap('concurrent-delivery','SELECT id FROM "KioskAssignment" WHERE "kioskId"=$1 AND "assignedTo" IS NULL FOR UPDATE',[kiosk.id],[
    () => http('delivery-concurrent-first',d1,'PATCH',`/api/orders/${delivery.id}/deliver`),
    () => http('delivery-concurrent-second',d1,'PATCH',`/api/orders/${delivery.id}/deliver`),
  ]);
  const ds = await c.snapshot('concurrent-delivery-final-snapshot',delivery.id);
  const ledger = await prisma.kioskAssignment.findMany({where:{kioskId:kiosk.id},orderBy:{assignedFrom:'asc'}});
  check('concurrent-delivery-one-active-assignment',ledger.filter((x:any)=>!x.assignedTo).length===1,{ledger,statuses:deliveryResults.map(x=>x.status)});

  // Real API update interleaved while a delivery is paused before history closure.
  const k2 = await prisma.kiosk.create({data:{machineCode:'AUDIT-RACE-STATE',model:'State concurrency fixture',currentOrgId:d1.orgId,status:'AVAILABLE'}});
  await prisma.kioskAssignment.create({data:{kioskId:k2.id,organizationId:d1.orgId,assignedById:d1.userId}});
  const stateOrder = await c.order('state-race-allocation',d1,'ALLOCATION',p);
  await http('state-race-paid',d1,'PATCH',`/api/orders/${stateOrder.id}/paid`,undefined,200);
  await http('state-race-dispatch',d1,'PATCH',`/api/orders/${stateOrder.id}/dispatch`,undefined,200);
  const block = new pg.Client({connectionString:c.auditUrl.href,application_name:'audit_barrier'});
  await block.connect(); await block.query('BEGIN');
  await block.query('SELECT id FROM "KioskAssignment" WHERE "kioskId"=$1 AND "assignedTo" IS NULL FOR UPDATE',[k2.id]);
  const pendingDelivery = http('state-race-delivery',d1,'PATCH',`/api/orders/${stateOrder.id}/deliver`);
  try {
    const deadline = Date.now()+2000;
    while(Date.now()<deadline) {
      if(Number((await sql.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].count)>0) break;
      await new Promise(r=>setTimeout(r,30));
    }
    await http('concurrent-kiosk-retirement',d1,'PATCH',`/api/kiosks/${k2.id}/status`,{status:'RETIRED'},400);
  } finally { await block.query('COMMIT'); await block.end(); }
  await pendingDelivery;
  const state = await prisma.kiosk.findUnique({where:{id:k2.id}});
  c.record('concurrent-state-change-overwritten',{row:state});
}
