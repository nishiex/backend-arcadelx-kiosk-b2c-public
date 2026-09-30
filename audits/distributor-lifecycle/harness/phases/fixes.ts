import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function run(c:any) {
  const {prisma,company:co,distributor:d,partner:p,unrelated:u,actors,terms}=c;
  const must=(id:string,condition:boolean,details={})=>{c.check(id,condition,details);if(!condition)throw new Error(`Regression failed: ${id}`);};
  const hit=async(id:string,actor:any,method:string,url:string,body?:any,expected:number|number[]=200)=>{
    const r=await c.http(id,actor,method,url,body,expected);
    if(!(Array.isArray(expected)?expected:[expected]).includes(r.status))throw new Error(`${id}: HTTP ${r.status}`);
    return r;
  };
  const own=await prisma.kiosk.findFirstOrThrow({where:{currentOrgId:d.orgId,status:'AVAILABLE'}});
  for(const actor of [null,actors['company-pending'],actors['company-rejected'],...['MANAGER','STAFF'].flatMap(role=>[actors[`${co.label}-${role}`],actors[`${d.label}-${role}`],actors[`${p.label}-${role}`]])]) {
    const label=actor?.label||'anonymous';
    const code=actor?403:401;
    const body=c.registration(`forbidden-${label}-${c.next()}`,actor?.type==='DISTRIBUTOR'?'PARTNER':'DISTRIBUTOR');
    for(const [name,method,url,payload] of [
      ['register','POST','/api/auth/register',body],
      ['mint','POST','/api/kiosks/batch',{count:1,model:'Denied'}],
      ['status','PATCH',`/api/kiosks/${own.id}/status`,{status:'AVAILABLE'}],
      ['agreement','POST','/api/agreements/create',terms(c.upConnection.id,d.orgId)],
      ['approve-agreement','PATCH',`/api/agreements/${c.upAgreement.id}/approve`,undefined],
      ['order','POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1}],
      ...['approve','paid','dispatch','deliver'].map(action=>[action,'PATCH',`/api/orders/${c.upOrder.id}/${action}`,undefined]),
      ['retry-credentials','POST',`/api/auth/organizations/${d.orgId}/credentials/retry`,undefined],
      ['retry-invoice','POST',`/api/orders/${c.upOrder.id}/invoice/retry`,undefined],
    ] as any[]) await hit(`F1-${label}-${name}`,actor,method,url,payload,code);
  }
  await hit('F1-distributor-cannot-mint',d,'POST','/api/kiosks/batch',{count:1,model:'Denied'},403);
  await hit('F1-partner-cannot-create',p,'POST','/api/auth/register',c.registration('partner-forbidden','PARTNER'),403);
  await c.register('company-admin-created',actors[`${co.label}-ADMIN`]);
  await c.register('distributor-admin-created',actors[`${d.label}-ADMIN`],'PARTNER');

  // No C -> U network exists. A different active C -> D link must not authorize U.
  must('F2-unrelated-has-no-network',(await prisma.networkConnection.count({where:{receiverOrgId:u.orgId}}))===0);
  await hit('F2-mismatched-network',co,'POST','/api/agreements/create',terms(c.upConnection.id,u.orgId),400);
  for(const target of [co,d,u]) await hit(`F2-invalid-distributor-child-${target.label}`,d,'POST','/api/agreements/create',terms(c.upConnection.id,target.orgId),400);
  await hit('F2-company-self',co,'POST','/api/agreements/create',terms(c.upConnection.id,co.orgId),400);
  await hit('F2-unrelated-order-denied',u,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1},403);
  const p2=await c.register('slot-partner',d,'PARTNER');
  const n2=await c.connect('slot-network',d,p2);
  const draft=(await hit('F3-first-draft',d,'POST','/api/agreements/create',terms(n2.id,p2.orgId),201)).data.data.agreement;
  await hit('F3-second-draft-denied',d,'POST','/api/agreements/create',terms(n2.id,p2.orgId),409);
  await hit('F3-approve',p2,'PATCH',`/api/agreements/${draft.id}/approve`);
  await hit('F3-active-duplicate-denied',d,'POST','/api/agreements/create',terms(n2.id,p2.orgId),409);
  must('F3-one-active',(await prisma.agreement.count({where:{childOrgId:p2.orgId,status:'ACTIVE'}}))===1);
  // A different distributor must not acquire the same partner either.
  const un=await c.connect('unrelated-upstream',co,u);
  await c.agreement('unrelated-upstream-agreement',co,u,un);
  const otherLink=await c.connect('other-distributor-slot',u,p2);
  await hit('F3-other-distributor-denied',u,'POST','/api/agreements/create',terms(otherLink.id,p2.orgId),409);

  const allocation=await c.order('protected-allocation',d,'ALLOCATION',p);
  const reserved=await c.snapshot('protected-reservation',allocation.id);
  const kid=reserved.dispatchedKiosks[0].kioskId;
  must('F4-reservation-owner-recorded',reserved.dispatchedKiosks[0].kiosk.reservedOrderId===allocation.id);
  for(const status of ['AVAILABLE','ASSIGNED','RESERVED','RETIRED','MAINTENANCE']) await hit(`F4-manual-${status}-denied`,d,'PATCH',`/api/kiosks/${kid}/status`,{status},409);
  await hit('F4-double-allocation-denied',d,'POST','/api/orders/create',{type:'ALLOCATION',targetOrgId:p.orgId,quantity:1},409);
  must('F4-single-active-commitment',(await prisma.orderKiosk.count({where:{kioskId:kid,order:{status:{in:['APPROVED','DISPATCHED']}}}}))===1);
  for(const action of ['paid','dispatch']) await hit(`F5-${action}`,d,'PATCH',`/api/orders/${allocation.id}/${action}`);
  await hit('F4-transit-retirement-denied',d,'PATCH',`/api/kiosks/${kid}/status`,{status:'RETIRED'},409);
  // Explicit corrupted legacy fixture: emulate ownership having changed outside
  // this order. Corrected delivery must refuse it and leave all history untouched.
  await prisma.kiosk.update({where:{id:kid},data:{currentOrgId:u.orgId}});
  c.record('F5-stale-ownership-fixture',{kind:'direct DB fixture',kioskId:kid,owner:u.orgId});
  const historyBefore=await prisma.kioskAssignment.findMany({where:{kioskId:kid}});
  await hit('F5-stale-owner-rejected',d,'PATCH',`/api/orders/${allocation.id}/deliver`,undefined,409);
  const stale=await prisma.kiosk.findUniqueOrThrow({where:{id:kid}});
  must('F5-stale-owner-preserved',stale.currentOrgId===u.orgId && JSON.stringify(historyBefore)===JSON.stringify(await prisma.kioskAssignment.findMany({where:{kioskId:kid}})));
  await prisma.kiosk.update({where:{id:kid},data:{currentOrgId:d.orgId}});
  await hit('F5-valid-delivery',d,'PATCH',`/api/orders/${allocation.id}/deliver`);
  must('F5-reservation-cleared',(await prisma.kiosk.findUniqueOrThrow({where:{id:kid}})).reservedOrderId===null);
  await hit('F5-repeat-delivery-denied',d,'PATCH',`/api/orders/${allocation.id}/deliver`,undefined,400);

  // Failure remains queued, successful retry uses the identical password and
  // recipient; a retry can never recreate an organization or rotate credentials.
  c.setFailMail(true);
  const input={...c.registration('recoverable-credentials'),inviteCode:await c.invite(co)};
  const created=await hit('F6-create-with-mail-failure',co,'POST','/api/auth/register',input,201);
  c.setFailMail(false);
  const org=created.data.data.organization;
  must('F6-creation-reports-unsent',created.data.data.credentialsEmailSent===false);
  let delivery=await prisma.emailDelivery.findUniqueOrThrow({where:{key:`organization:${org.id}:credentials`}});
  must('F6-payload-encrypted',delivery.payload.split('.').length===3 && !delivery.payload.includes(input.ownerEmail) && !delivery.payload.includes('temporaryPassword') && !delivery.sentAt);
  const passwordBefore=(await prisma.user.findUniqueOrThrow({where:{email:input.ownerEmail}})).passwordHash;
  const retry=`/api/auth/organizations/${org.id}/credentials/retry`;
  await hit('F6-wrong-organization-retry',u,'POST',retry,undefined,404);
  const countBefore=c.mails.length;
  const retries=await Promise.all([hit('F6-concurrent-retry-one',co,'POST',retry,undefined,[200,202]),hit('F6-concurrent-retry-two',co,'POST',retry,undefined,[200,202])]);
  must('F6-retry-delivers-once',retries.some(r=>r.status===200) && c.mails.length===countBefore+1);
  await hit('F6-repeat-retry-idempotent',co,'POST',retry);
  must('F6-repeat-did-not-resend',c.mails.length===countBefore+1);
  delivery=await prisma.emailDelivery.findUniqueOrThrow({where:{id:delivery.id}});
  must('F6-sent-payload-erased',!!delivery.sentAt && delivery.payload==='');
  must('F6-password-not-rotated',passwordBefore===(await prisma.user.findUniqueOrThrow({where:{email:input.ownerEmail}})).passwordHash);
  const message=c.mails.findLast((m:any)=>m.To[0].Email===input.ownerEmail);
  await c.login('recovered-owner',input.ownerEmail,message.TextPart.match(/Temporary Password:\s*([^\s]+)/)[1]);
  const req=await c.order('recoverable-invoice',d,'REQUEST',co);
  c.setFailMail(true);
  const approved=await hit('F6-approval-with-mail-failure',co,'PATCH',`/api/orders/${req.id}/approve`);
  c.setFailMail(false);
  must('F6-approval-reports-success-and-email-failure',approved.data.data.order.status==='APPROVED' && approved.data.data.invoiceReady===true && approved.data.data.invoiceEmailSent===false);
  const before=await c.snapshot('F6-before-invoice-retry',req.id);
  await hit('F6-child-invoice-retry-denied',d,'POST',`/api/orders/${req.id}/invoice/retry`,undefined,404);
  await hit('F6-invoice-retry',co,'POST',`/api/orders/${req.id}/invoice/retry`);
  const after=await c.snapshot('F6-after-invoice-retry',req.id);
  must('F6-retry-preserves-reservation',before.dispatchedKiosks[0].kioskId===after.dispatchedKiosks[0].kioskId && after.status==='APPROVED');
  await hit('F7-returned-url',d,'GET',after.invoiceUrl);

  const pdfOrder=await c.order('recoverable-pdf',d,'REQUEST',co);
  const obstacle=path.join(c.outDir,'invoices',`${pdfOrder.orderNumber}.pdf`);
  await fs.mkdir(obstacle); // Our new empty test directory, never a user file.
  const pdfFail=await hit('F6-pdf-failure-still-committed',co,'PATCH',`/api/orders/${pdfOrder.id}/approve`);
  must('F6-pdf-retryable',pdfFail.data.data.order.status==='APPROVED' && pdfFail.data.data.invoiceReady===false && pdfFail.data.data.invoiceEmailSent===false);
  await fs.rmdir(obstacle);
  await hit('F6-pdf-retry-recovers',co,'POST',`/api/orders/${pdfOrder.id}/invoice/retry`);
  const pdfRow=await prisma.order.findUniqueOrThrow({where:{id:pdfOrder.id}});
  await hit('F7-recovered-pdf-url',d,'GET',pdfRow.invoiceUrl);
  for(const value of [1000.75,-1,2147483648]) await hit(`F8-invalid-amount-${value}`,co,'POST','/api/agreements/create',terms(c.upConnection.id,d.orgId,{depositAmountPerMachine:value}),400);
  for(const quantity of [0,-1,1.5,51]) await hit(`F10-invalid-quantity-${quantity}`,d,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity},400);
  await hit('F10-invalid-invite',null,'POST','/api/auth/join',{name:'Invalid',email:'bad-invite@example.invalid',password:c.password,inviteCode:'MISSING'},404);
  await hit('F10-invalid-filter',co,'GET','/api/orders?status=INVALID',undefined,400);
  await hit('F10-invalid-pagination',co,'GET','/api/network/requests?limit=0',undefined,400);
  const list=await hit('F11-profiles',co,'GET','/api/network/distributors');
  const profile=list.data.data.distributors.find((x:any)=>x.id===d.orgId);
  must('F11-values-preserved',profile.gstNumber==='AUDIT-GST' && profile.phone==='9999999999' && profile.country==='India');
  await hit('F11-invalid-profile',co,'POST','/api/auth/register',{...c.registration('profile-too-long'),phone:'x'.repeat(33)},400);
  await hit('F9-active-history-denied',co,'DELETE',`/api/network/${c.upConnection.id}`,undefined,409);
  const td=await c.register('history-distributor',co);
  const tn=await c.connect('history-network',co,td);
  const ta=(await hit('F9-pending-draft',co,'POST','/api/agreements/create',terms(tn.id,td.orgId),201)).data.data.agreement;
  await hit('F9-pending-history-denied',co,'DELETE',`/api/network/${tn.id}`,undefined,409);
  await hit('F9-approve',td,'PATCH',`/api/agreements/${ta.id}/approve`);
  await hit('F9-terminate',co,'DELETE',`/api/agreements/${ta.id}/terminate`);
  await hit('F9-terminated-history-denied',co,'DELETE',`/api/network/${tn.id}`,undefined,409);
  must('F9-history-preserved',!!(await prisma.networkConnection.findUnique({where:{id:tn.id}})) && (await prisma.agreement.findUniqueOrThrow({where:{id:ta.id}})).status==='TERMINATED');

  // Database constraints protect reservations and ledger even from invalid direct writes.
  for(const [id,query,args] of [
    ['open-ledger','INSERT INTO "KioskAssignment" (id,"kioskId","organizationId","assignedById") VALUES (\'duplicate-audit\',$1,$2,$3)',[kid,p.orgId,d.userId]],
    ['orphan-reservation','UPDATE "Kiosk" SET status=\'RESERVED\' WHERE id=$1',[kid]],
  ] as any[]) {
    await c.sql.query('BEGIN'); let rejected=false;
    try{await c.sql.query(query,args);}catch{rejected=true;}finally{await c.sql.query('ROLLBACK');}
    must(`DB-${id}-rejected`,rejected);
  }

  async function overlap(label:string,lock:string,params:any[],calls:(()=>Promise<any>)[]) {
    const blocker=new pg.Client({connectionString:c.auditUrl.href,application_name:'fix_barrier'});
    await blocker.connect();await blocker.query('BEGIN');await blocker.query(lock,params);
    const pending=calls.map(fn=>fn());let waiting=0;
    try {
      const deadline=Date.now()+2500;
      do {
        waiting=Number((await c.sql.query("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND application_name<>'fix_barrier'")).rows[0].count);
        if(waiting>=calls.length)break;
        await new Promise(r=>setTimeout(r,25));
      }while(Date.now()<deadline);
    }finally{await blocker.query('COMMIT');await blocker.end();}
    const result=await Promise.all(pending);
    must(`${label}-overlap-confirmed`,waiting>=calls.length,{waiting,statuses:result.map(r=>r.status)});
    return result;
  }
  await hit('race-mint-stock',co,'POST','/api/kiosks/batch',{count:6,model:'Race stock'},201);
  const r1=await c.order('race-request-A',d,'REQUEST',co);
  const r2=await c.order('race-request-B',u,'REQUEST',co);
  await overlap('R1','SELECT id FROM "Order" WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[[r1.id,r2.id]],[
    ()=>hit('R1-approval-A',co,'PATCH',`/api/orders/${r1.id}/approve`),
    ()=>hit('R1-approval-B',co,'PATCH',`/api/orders/${r2.id}/approve`),
  ]);
  const [a,b]=await Promise.all([prisma.orderKiosk.findMany({where:{orderId:r1.id}}),prisma.orderKiosk.findMany({where:{orderId:r2.id}})]);
  must('R1-disjoint-reservations',a.length===1 && b.length===1 && a[0].kioskId!==b[0].kioskId);
  const same=await c.order('race-same-request',d,'REQUEST',co);
  const sameResults=await overlap('R2','SELECT id FROM "Order" WHERE id=$1 FOR UPDATE',[same.id],[
    ()=>hit('R2-approval-A',co,'PATCH',`/api/orders/${same.id}/approve`,undefined,[200,400]),
    ()=>hit('R2-approval-B',co,'PATCH',`/api/orders/${same.id}/approve`,undefined,[200,400]),
  ]);
  must('R2-one-approval',sameResults.map(r=>r.status).sort().join(',')==='200,400');
  const numberResults=await overlap('R3','LOCK TABLE "OrderSequence" IN SHARE MODE',[],[
    ()=>hit('R3-create-A',d,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1},201),
    ()=>hit('R3-create-B',u,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1},201),
  ]);
  must('R3-unique-numbers',numberResults[0].data.data.order.orderNumber!==numberResults[1].data.data.order.orderNumber);
  for(const action of ['paid','dispatch']) await hit(`R4-${action}`,co,'PATCH',`/api/orders/${r1.id}/${action}`);
  const deliveryResults=await overlap('R4','SELECT id FROM "Order" WHERE id=$1 FOR UPDATE',[r1.id],[
    ()=>hit('R4-delivery-A',co,'PATCH',`/api/orders/${r1.id}/deliver`,undefined,[200,400]),
    ()=>hit('R4-delivery-B',co,'PATCH',`/api/orders/${r1.id}/deliver`,undefined,[200,400]),
  ]);
  must('R4-one-delivery',deliveryResults.map(r=>r.status).sort().join(',')==='200,400');
  must('R4-one-open-assignment',(await prisma.kioskAssignment.count({where:{kioskId:a[0].kioskId,assignedTo:null}}))===1);
  const rp=await c.register('race-new-partner',d,'PARTNER');
  const networkResults=await overlap('R5','LOCK TABLE "NetworkConnection" IN SHARE MODE',[],[
    ()=>hit('R5-initiate-A',d,'POST','/api/network/initiate',{targetOwnerEmail:rp.email},[201,409]),
    ()=>hit('R5-initiate-B',d,'POST','/api/network/initiate',{targetOwnerEmail:rp.email},[201,409]),
  ]);
  must('R5-one-connection',networkResults.map(r=>r.status).sort().join(',')==='201,409');
  const rn=networkResults.find(r=>r.status===201).data.data.connection;
  const acceptResults=await overlap('R7','SELECT id FROM "NetworkConnection" WHERE id=$1 FOR UPDATE',[rn.id],[
    ()=>hit('R7-accept-A',rp,'POST',`/api/network/${rn.id}/accept`,undefined,[200,404]),
    ()=>hit('R7-accept-B',rp,'POST',`/api/network/${rn.id}/accept`,undefined,[200,404]),
  ]);
  must('R7-one-acceptance',acceptResults.map(r=>r.status).sort().join(',')==='200,404');
  const agreements=await overlap('R6','SELECT id FROM "Organization" WHERE id=$1 FOR UPDATE',[rp.orgId],[
    ()=>hit('R6-draft-A',d,'POST','/api/agreements/create',terms(rn.id,rp.orgId),[201,409]),
    ()=>hit('R6-draft-B',d,'POST','/api/agreements/create',terms(rn.id,rp.orgId),[201,409]),
  ]);
  must('R6-one-draft',agreements.map(r=>r.status).sort().join(',')==='201,409');
  const ra=agreements.find(r=>r.status===201).data.data.agreement;
  const approvals=await overlap('R8','SELECT id FROM "Organization" WHERE id=$1 FOR UPDATE',[rp.orgId],[
    ()=>hit('R8-approve-A',rp,'PATCH',`/api/agreements/${ra.id}/approve`,undefined,[200,404]),
    ()=>hit('R8-approve-B',rp,'PATCH',`/api/agreements/${ra.id}/approve`,undefined,[200,404]),
  ]);
  must('R8-one-activation',approvals.map(r=>r.status).sort().join(',')==='200,404');
  // d received one kiosk during R4, so downstream uses actual transferred stock.
  const stateOrder=await c.order('race-downstream-state',d,'ALLOCATION',rp);
  for(const action of ['paid','dispatch'])await hit(`R9-${action}`,d,'PATCH',`/api/orders/${stateOrder.id}/${action}`);
  const stateKiosk=(await prisma.orderKiosk.findFirstOrThrow({where:{orderId:stateOrder.id}})).kioskId;
  await overlap('R9','SELECT id FROM "Kiosk" WHERE id=$1 FOR UPDATE',[stateKiosk],[
    ()=>hit('R9-deliver',d,'PATCH',`/api/orders/${stateOrder.id}/deliver`),
    ()=>hit('R9-manual-retire',d,'PATCH',`/api/kiosks/${stateKiosk}/status`,{status:'RETIRED'},[403,409]),
  ]);
  const final=await prisma.kiosk.findUniqueOrThrow({where:{id:stateKiosk}});
  must('R9-valid-final-owner',final.currentOrgId===rp.orgId && final.status==='AVAILABLE' && final.reservedOrderId===null);
  c.record('F1-F11-fix-suite-complete',{passed:true});
}
