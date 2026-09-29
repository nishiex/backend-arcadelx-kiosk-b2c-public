import crypto from 'node:crypto';

export async function run(c: any) {
  const {sql,prisma,http,check,company:co,distributor:d,partner:p,actors} = c;
  const random = () => crypto.randomUUID();
  async function probe(id:string,statement:string,args:any[],expectedCode:string|null) {
    await sql.query('BEGIN');
    let code=null;
    try { await sql.query(statement,args); }
    catch(error:any) {code=error.code;}
    finally {await sql.query('ROLLBACK');}
    check(id,code===expectedCode,{kind:'database constraint probe; transaction rolled back',sql:statement,expectedCode,actualCode:code});
  }
  await probe('db-single-company-enforced','INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,"updatedAt") VALUES ($1,$2,\'second\',\'COMPANY\',\'state\',\'city\',400001,\'address\',now())',[random(),co.userId],'23505');
  await probe('db-membership-user-unique','INSERT INTO "Membership" (id,"userId","organizationId",role,status,"updatedAt") VALUES ($1,$2,$3,\'OWNER\',\'ACTIVE\',now())',[random(),d.userId,d.orgId],'23505');
  await probe('db-kiosk-owner-foreign-key','UPDATE "Kiosk" SET "currentOrgId"=$1 WHERE id=$2',[random(),c.finalKiosk.id],'23503');
  await probe('db-negative-deposit-check','UPDATE "Agreement" SET "depositAmountPerMachine"=-1 WHERE id=$1',[c.upAgreement.id],'23514');
  await probe('db-negative-nonrefundable-check','UPDATE "Agreement" SET "nonRefundableAmountPerMachine"=-1 WHERE id=$1',[c.upAgreement.id],'23514');
  await probe('db-share-total-missing-check','UPDATE "Agreement" SET "parentSharePct"=99,"childSharePct"=99 WHERE id=$1',[c.upAgreement.id],null);
  await probe('db-order-quantity-missing-check','UPDATE "Order" SET quantity=-1 WHERE id=$1',[c.upOrder.id],null);
  await probe('db-order-financial-missing-check','UPDATE "Order" SET "grandTotal"=-100 WHERE id=$1',[c.upOrder.id],null);
  await probe('db-order-parent-agreement-mismatch-allowed','UPDATE "Order" SET "parentOrgId"=$1 WHERE id=$2',[p.orgId,c.upOrder.id],null);
  await probe('db-kiosk-assignment-current-owner-mismatch-allowed','UPDATE "KioskAssignment" SET "organizationId"=$1 WHERE "kioskId"=$2 AND "assignedTo" IS NULL',[co.orgId,c.finalKiosk.id],null);
  c.record('audit-column-types',{rows:(await sql.query("SELECT table_name,column_name,data_type,udt_name,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows});
  // Exercise actual membership transitions; lower-role downstream fixtures above were explicit setup.
  const invite = await http('membership-company-admin-invite',actors[`${co.label}-ADMIN`],'POST','/api/members/generateInviteCode',undefined,201);
  const code = invite.data.data.inviteCode;
  await http('membership-distributor-cannot-invite',d,'POST','/api/members/generateInviteCode',undefined,403);
  await http('membership-partner-cannot-invite',p,'POST','/api/members/generateInviteCode',undefined,403);
  const email='membership-joiner@example.invalid';
  await http('membership-public-join',null,'POST','/api/auth/join',{name:'Membership joiner',email,password:c.password,inviteCode:code},201);
  // Avoid reissuing a same-user JWT inside the same second; use the join cookie directly.
  const user = await prisma.user.findUniqueOrThrow({where:{email},include:{membership:true}});
  const pending = user.membership!;
  check('joined-membership-pending-without-role',pending.status==='PENDING' && pending.role===null,{membership:pending});
  const route=`/api/members/requests/${pending.id}`;
  await http('membership-admin-cannot-grant-admin',actors[`${co.label}-ADMIN`],'POST',route,{action:'APPROVE',role:'ADMIN'},403);
  await http('membership-owner-approve-admin',co,'POST',route,{action:'APPROVE',role:'ADMIN'},200);
  await http('membership-repeat-approval-denied',co,'POST',route,{action:'APPROVE',role:'STAFF'},400);
  await http('membership-owner-demote-to-staff',co,'PATCH',`/api/members/${pending.id}/role`,{role:'STAFF'},200);
  await http('membership-admin-remove-staff',actors[`${co.label}-ADMIN`],'DELETE',`/api/members/${pending.id}`,undefined,200);
  check('membership-removal-retains-user',!(await prisma.membership.findUnique({where:{id:pending.id}})) && !!(await prisma.user.findUnique({where:{id:user.id}})));
  await http('removed-user-cannot-rejoin-existing-email',null,'POST','/api/auth/join',{name:'Membership joiner',email,password:c.password,inviteCode:code},409);
  const rejectedEmail='membership-rejected@example.invalid';
  await http('membership-second-public-join',null,'POST','/api/auth/join',{name:'Reject joiner',email:rejectedEmail,password:c.password,inviteCode:code},201);
  const rejected = await prisma.user.findUniqueOrThrow({where:{email:rejectedEmail},include:{membership:true}});
  await http('membership-admin-reject',actors[`${co.label}-ADMIN`],'POST',`/api/members/requests/${rejected.membership!.id}`,{action:'REJECT'},200);
  await http('rejected-membership-cannot-approve',co,'POST',`/api/members/requests/${rejected.membership!.id}`,{action:'APPROVE',role:'STAFF'},400);
  // Positive ADMIN coverage for creation and downstream fulfillment.
  await c.register('admin-created-distributor',actors[`${co.label}-ADMIN`]);
  await c.register('admin-created-partner',actors[`${d.label}-ADMIN`],'PARTNER');
  await http('distributor-admin-kiosk-status',actors[`${d.label}-ADMIN`],'PATCH',`/api/kiosks/${c.finalKiosk.id}/status`,{status:'AVAILABLE'},403);
  // Termination's actual downstream policy: direct active downstream agreement remains usable.
  const orphan = await prisma.agreement.findUniqueOrThrow({where:{id:c.downAgreement.id}});
  check('upstream-termination-leaves-downstream-active',orphan.status==='ACTIVE',{downstream:orphan});
  const stock = await prisma.kiosk.create({data:{machineCode:'AUDIT-AFTER-TERMINATION',model:'Termination policy fixture',currentOrgId:d.orgId,status:'AVAILABLE'}});
  c.record('after-termination-stock-fixture',{kind:'direct DB fixture',kioskId:stock.id,purpose:'Isolate downstream eligibility after upstream termination'});
  const after = await http('downstream-allocation-after-upstream-termination',actors[`${d.label}-ADMIN`],'POST','/api/orders/create',{type:'ALLOCATION',targetOrgId:p.orgId,quantity:1},403);
  if(after.status===201) for(const action of ['paid','dispatch','deliver']) await http(`downstream-admin-${action}-after-upstream-termination`,actors[`${d.label}-ADMIN`],'PATCH',`/api/orders/${after.data.data.order.id}/${action}`,undefined,200);
  const newPartner = await c.register('new-partner-after-termination',d,'PARTNER');
  const network = await c.connect('new-partner-after-termination-network',d,newPartner);
  await http('new-downstream-agreement-after-upstream-termination-denied',d,'POST','/api/agreements/create',c.terms(network.id,newPartner.orgId),400);
}
