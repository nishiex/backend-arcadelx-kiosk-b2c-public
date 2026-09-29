export async function run(c: any) {
  const { http, check, prisma, terms, actors, company: co, distributor: d, partner: p, unrelated: u } = c;
  const own = await prisma.kiosk.findFirstOrThrow({ where: { currentOrgId: d.orgId, status: 'AVAILABLE' } });
  // Route gate coverage: valid bodies, resource ownership checks, and all denied role classes.
  const denyActors = [null, actors['company-pending'], actors['company-rejected'], actors[`${co.label}-MANAGER`], actors[`${co.label}-STAFF`], actors[`${d.label}-MANAGER`], actors[`${d.label}-STAFF`], actors[`${p.label}-MANAGER`], actors[`${p.label}-STAFF`]];
  for (const a of denyActors) {
    const expected = a ? 403 : 401;
    const label = a?.label || 'anon';
    const ops: any[] = [
      ['register','POST','/api/auth/register',c.registration(`denied-${label}-${c.next()}`, a?.type === 'DISTRIBUTOR' ? 'PARTNER' : 'DISTRIBUTOR')],
      ['network-initiate','POST','/api/network/initiate',{targetOwnerEmail:u.email}],
      ['network-accept','POST',`/api/network/${c.upConnection.id}/accept`],
      ['network-delete','DELETE',`/api/network/${c.upConnection.id}`],
      ['agreement-create','POST','/api/agreements/create',terms(c.upConnection.id,d.orgId)],
      ['agreement-approve','PATCH',`/api/agreements/${c.upAgreement.id}/approve`],
      ['agreement-terminate','DELETE',`/api/agreements/${c.upAgreement.id}/terminate`],
      ['order-create','POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1}],
      ...['approve','paid','dispatch','deliver'].map(action => [`order-${action}`,'PATCH',`/api/orders/${c.upOrder.id}/${action}`]),
      ['kiosk-batch','POST','/api/kiosks/batch',{count:1,model:`Audit denied ${label}`}],
      ['kiosk-status','PATCH',`/api/kiosks/${own.id}/status`,{status:'AVAILABLE'}],
    ];
    for (const [name,method,url,body] of ops) await http(`authorization-${label}-${name}`,a,method,url,body,expected);
  }
  for (const a of [d,p,u]) await http(`company-only-batch-${a.label}`,a,'POST','/api/kiosks/batch',{count:1,model:'No'},403);
  await http('distributor-cannot-create-distributor',d,'POST','/api/auth/register',c.registration('bad-d-to-d'),403);
  await http('partner-cannot-create-partner',p,'POST','/api/auth/register',c.registration('bad-p-to-p','PARTNER'),403);
  for (const target of [co,u]) await http(`distributor-invalid-network-${target.label}`,d,'POST','/api/network/initiate',{targetOwnerEmail:target.email},405);
  await http('partner-cannot-initiate-network',p,'POST','/api/network/initiate',{targetOwnerEmail:u.email},403);
  await http('company-self-network-denied',co,'POST','/api/network/initiate',{targetOwnerEmail:co.email},400);
  await http('wrong-org-kiosk-status',u,'PATCH',`/api/kiosks/${own.id}/status`,{status:'RETIRED'},403);
  await http('partner-kiosk-status-denied',p,'PATCH',`/api/kiosks/${c.finalKiosk.id}/status`,{status:'INSTALLED',location:'Audit'},403);
  for (const a of [co,d,u,p]) for (const action of ['approve','paid','dispatch','deliver']) {
    const expected = a === co ? 400 : 403;
    await http(`completed-order-${a.label}-${action}`,a,'PATCH',`/api/orders/${c.upOrder.id}/${action}`,undefined,expected);
  }
  await http('anonymous-invoice',null,'GET',`/api/orders/${c.upOrder.id}/invoice`,undefined,401);
  await http('anonymous-inventory',null,'GET','/api/kiosks',undefined,401);
  await http('anonymous-order-list',null,'GET','/api/orders',undefined,401);
  await http('wrong-org-network-delete',u,'DELETE',`/api/network/${c.upConnection.id}`,undefined,404);
  await http('child-network-delete-denied',d,'DELETE',`/api/network/${c.upConnection.id}`,undefined,404);
  await http('active-agreement-network-delete-denied',co,'DELETE',`/api/network/${c.upConnection.id}`,undefined,400);
  for (const a of [d,u]) await http(`agreement-terminate-${a.label}-denied`,a,'DELETE',`/api/agreements/${c.upAgreement.id}/terminate`,undefined,404);
  for (const a of [actors[`${co.label}-ADMIN`],actors[`${d.label}-ADMIN`]]) {
    await http(`agreement-create-${a.label}-denied`,a,'POST','/api/agreements/create',terms(c.upConnection.id,d.orgId),403);
    await http(`agreement-terminate-${a.label}-denied`,a,'DELETE',`/api/agreements/${c.upAgreement.id}/terminate`,undefined,403);
    await http(`network-delete-${a.label}-denied`,a,'DELETE',`/api/network/${c.upConnection.id}`,undefined,403);
  }
  const nr = await http('company-admin-network-initiate',actors[`${co.label}-ADMIN`],'POST','/api/network/initiate',{targetOwnerEmail:u.email},201);
  c.unrelatedConnection = nr.data.data.connection;
  await http('receiver-admin-network-accept',actors[`${u.label}-ADMIN`],'POST',`/api/network/${c.unrelatedConnection.id}/accept`,undefined,200);
  // Incorrect terms and mismatched endpoints must be observed, not inferred.
  const split = await http('company-distributor-non-60-40',co,'POST','/api/agreements/create',terms(c.upConnection.id,d.orgId,{parentSharePct:75,childSharePct:25}),400);
  if (split.status === 201) c.record('non-60-40-stored', { row: await prisma.agreement.findUnique({where:{id:split.data.data.agreement.id}}) });
  await http('company-terms-cannot-inherit-from-self',co,'POST','/api/agreements/create',{networkConnectionId:c.upConnection.id,childOrgId:d.orgId},400);
  const wrong = await http('agreement-unrelated-child-endpoints',co,'POST','/api/agreements/create',terms(c.upConnection.id,u.orgId),400);
  if (wrong.status === 201) {
    await http('unrelated-child-can-approve-mismatched-agreement',u,'PATCH',`/api/agreements/${wrong.data.data.agreement.id}/approve`,undefined,200);
    const exploit = await c.order('mismatched-agreement-authorizes-order',u,'REQUEST',co);
    check('invalid-relationship-used-by-order',exploit.agreementId === wrong.data.data.agreement.id,{order:exploit});
  }
  for (const target of [co,u,d]) {
    const a = await http(`distributor-invalid-child-type-${target.label}`,d,'POST','/api/agreements/create',terms(c.upConnection.id,target.orgId),400);
    if (a.status === 201) await http(`invalid-child-type-approvable-${target.label}`,target,'PATCH',`/api/agreements/${a.data.data.agreement.id}/approve`,undefined,200);
  }
  const self = await http('company-self-agreement',co,'POST','/api/agreements/create',terms(c.upConnection.id,co.orgId),400);
  if (self.status === 201) await http('company-approves-own-self-agreement',co,'PATCH',`/api/agreements/${self.data.data.agreement.id}/approve`,undefined,200);
  await http('fractional-agreement-amount',co,'POST','/api/agreements/create',terms(c.upConnection.id,d.orgId,{depositAmountPerMachine:1000.75}),400);
  for (const quantity of [0,-1,1.5,51]) await http(`invalid-order-quantity-${quantity}`,d,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity},400);
  await http('order-without-active-agreement',u,'POST','/api/orders/create',{type:'ALLOCATION',targetOrgId:p.orgId,quantity:1},403);
  await http('invalid-invite-code',null,'POST','/api/auth/join',{name:'Bad invite',email:'invalid-invite@example.invalid',password:c.password,inviteCode:'INVALID'},404);
  const list = await http('distributor-extra-fields-after-create',co,'GET','/api/network/distributors',undefined,200);
  const listed = list.data.data.distributors.find((x:any)=>x.id===d.orgId);
  check('submitted-distributor-fields-retained',listed.gstNumber==='AUDIT-GST' && listed.phone==='9999999999' && listed.country==='India',{actual:listed});
  // Multiple pending partner agreements circumvent the single active distributor rule.
  const p2 = await c.register('duplicate-partner',d,'PARTNER');
  const nc2 = await c.connect('duplicate-partner-network',d,p2);
  const ags = [];
  for(let i=0;i<2;i++) {
    const r = await http(`duplicate-pending-agreement-${i}`,d,'POST','/api/agreements/create',terms(nc2.id,p2.orgId),i===0?201:409);
    if(r.status===201) ags.push(r.data.data.agreement);
  }
  for(let i=0;i<ags.length;i++) await http(`duplicate-pending-approve-${i}`,p2,'PATCH',`/api/agreements/${ags[i].id}/approve`,undefined,i===0?200:409);
  check('at-most-one-active-partner-agreement',(await prisma.agreement.count({where:{childOrgId:p2.orgId,status:'ACTIVE'}}))===1,{count:await prisma.agreement.count({where:{childOrgId:p2.orgId,status:'ACTIVE'}})});
  await http('existing-active-partner-agreement-rejected',d,'POST','/api/agreements/create',terms(nc2.id,p2.orgId),409);
  // Email failure occurs after commits. Only test transport is changed.
  c.setFailMail(true);
  const registration = c.registration('mail-failure-distributor');
  await http('registration-email-failure',co,'POST','/api/auth/register',registration,500);
  c.setFailMail(false);
  const persisted = await prisma.user.findUnique({where:{email:registration.ownerEmail},include:{membership:true}});
  check('failed-registration-left-active-account',!!persisted && persisted.membership?.status==='ACTIVE',{userId:persisted?.id,membership:persisted?.membership});
  await http('retry-after-registration-email-failure',co,'POST','/api/auth/register',registration,409);
  const req = await c.order('email-failure-order',d,'REQUEST',co);
  c.setFailMail(true);
  await http('approval-email-failure',co,'PATCH',`/api/orders/${req.id}/approve`,undefined,500);
  c.setFailMail(false);
  const approved = await c.snapshot('approval-committed-despite-email-failure',req.id);
  check('failed-approval-left-reserved-stock',approved.status==='APPROVED' && approved.dispatchedKiosks.length===1 && !!approved.invoiceFilename);
  await http('retry-after-approval-email-failure',co,'PATCH',`/api/orders/${req.id}/approve`,undefined,400);
  // Direct status writes break reservation invariants even without concurrency.
  const first = await c.order('status-bypass-first',d,'ALLOCATION',p);
  const firstSnap = await c.snapshot('status-bypass-first-reserved',first.id);
  const kid = firstSnap.dispatchedKiosks[0].kioskId;
  await http('reserved-kiosk-manually-released',actors[`${d.label}-STAFF`],'PATCH',`/api/kiosks/${kid}/status`,{status:'AVAILABLE'},403);
  const second = await c.order('status-bypass-second',d,'ALLOCATION',p);
  const secondSnap = await c.snapshot('status-bypass-second-reserved',second.id);
  check('one-kiosk-one-active-order',!secondSnap.dispatchedKiosks.some((x:any)=>x.kioskId===kid),{firstOrder:first.id,secondOrder:second.id,kioskId:kid});
  await http('status-bypass-mark-paid',d,'PATCH',`/api/orders/${first.id}/paid`,undefined,200);
  await http('status-bypass-dispatch',d,'PATCH',`/api/orders/${first.id}/dispatch`,undefined,200);
  await http('in-transit-kiosk-retired',d,'PATCH',`/api/kiosks/${kid}/status`,{status:'RETIRED'},400);
  await http('delivery-overwrites-retired-status',d,'PATCH',`/api/orders/${first.id}/deliver`,undefined,400);
  c.record('delivery-after-retired-state', {row:await prisma.kiosk.findUnique({where:{id:kid}})});
  // Upstream termination does not invalidate downstream agreements or pending orders.
  const beforeTermination = await c.order('request-before-termination',d,'REQUEST',co);
  await http('company-terminate-upstream',co,'DELETE',`/api/agreements/${c.upAgreement.id}/terminate`,undefined,200);
  const ended = await prisma.agreement.findUnique({where:{id:c.upAgreement.id}});
  check('termination-keeps-history',ended?.status==='TERMINATED' && !!ended.effectiveTo && !!(await prisma.order.findUnique({where:{id:c.upOrder.id}})),{ended});
  await http('terminated-agreement-cannot-reapprove',d,'PATCH',`/api/agreements/${c.upAgreement.id}/approve`,undefined,404);
  await http('new-order-after-upstream-termination',d,'POST','/api/orders/create',{type:'REQUEST',targetOrgId:co.orgId,quantity:1},403);
  await http('old-request-approved-after-termination',co,'PATCH',`/api/orders/${beforeTermination.id}/approve`,undefined,403);
  // Other pending agreements on the same link also prevent physical deletion at the DB layer.
  await http('network-delete-with-historical-agreements',co,'DELETE',`/api/network/${c.upConnection.id}`,undefined,400);
  // Fresh link with only one terminated agreement isolates the foreign-key failure.
  const td = await c.register('termination-distributor',co);
  const tn = await c.connect('termination-network',co,td);
  const ta = await c.agreement('termination-agreement',co,td,tn);
  await http('terminate-isolated-agreement',co,'DELETE',`/api/agreements/${ta.id}/terminate`,undefined,200);
  await http('delete-link-with-only-terminated-agreement',co,'DELETE',`/api/network/${tn.id}`,undefined,400);
  const pd = await c.register('pending-link-distributor',co);
  const pn = await c.connect('pending-link-network',co,pd);
  await http('pending-link-agreement',co,'POST','/api/agreements/create',terms(pn.id,pd.orgId),201);
  await http('delete-link-with-only-pending-agreement',co,'DELETE',`/api/network/${pn.id}`,undefined,400);
  // An unused link can actually be deleted by its initiator OWNER.
  const ud = await c.register('unused-link-distributor',co);
  const un = await c.connect('unused-link-network',co,ud);
  await http('delete-unused-network',co,'DELETE',`/api/network/${un.id}`,undefined,200);
}
