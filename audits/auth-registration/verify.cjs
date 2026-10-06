// Actual application HTTP handlers, a NEW local database, and captured email.
// Run: node -r ./audits/auth-registration/runtime-loader.cjs audits/auth-registration/verify.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const dotenv = require('dotenv');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const Mailjet = require('node-mailjet');
const root = path.resolve(__dirname, '../..');
const stamp = new Date().toISOString().replace(/\D/g, '');
const baseline = process.argv.includes('--baseline');
const local = dotenv.parse(fs.readFileSync(path.join(root, '.env.local-backup-20261005')));
const url = new URL(local.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '5433');
const database = `arcadelx_audit_${stamp}`;
const repairName = '20261005121000_restore_registration_fields';
const repair = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations', repairName, 'migration.sql'), 'utf8');
const results = [];
let completed = false;
const mails = [];
let failMail = false;
Mailjet.apiConnect = () => ({ post: () => ({ request: async body => {
  if (failMail) throw new Error('Simulated email failure');
  mails.push(body.Messages[0]); return { body: { Messages: [{ Status: 'success' }] } };
} }) });

async function main() {
  const admin = new Client({ connectionString: url.href });
  await admin.connect(); await admin.query(`CREATE DATABASE "${database}"`); await admin.end();
  url.pathname = '/' + database;
  const c = new Client({ connectionString: url.href }); await c.connect();
  const password = crypto.randomBytes(24).toString('base64url');
  Object.assign(process.env, {
    DATABASE_URL: url.href, DIRECT_URL: url.href, NODE_ENV: 'development',
    ACCESS_SECRET_TOKEN: crypto.randomBytes(64).toString('hex'), REFRESH_SECRET_TOKEN: crypto.randomBytes(64).toString('hex'),
    INTERNAL_API_SECRET: crypto.randomBytes(32).toString('hex'), ACCESS_EXPIRY: '2h', REFRESH_EXPIRY: '7d',
    MAILJET_API_KEY: 'test-capture', MAILJET_SECRET_KEY: 'test-capture', MAIL_FROM_EMAIL: 'test@example.invalid', MAIL_FROM_NAME: 'Auth test', FRONTEND_LOGIN_URL: 'http://localhost:3000/login',
    REVENUE_REPORTS_DIR: path.join(os.tmpdir(), database, 'reports'), REVENUE_JOBS_ENABLED: 'false',
  });
  let server, prisma;
  const check = (label, passed) => { assert.ok(passed, label); results.push({ label, pass: true }); console.log('PASS', label); };
  try {
    const dir = path.join(root, 'apps/api/prisma/migrations');
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === '20261005190000_add_owner_contact') {
        await c.query('INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,now())', ['contact-upgrade-user','contact-upgrade@example.invalid','Existing User','unused-test-hash']);
      }
      const file = path.join(dir, name, 'migration.sql'); if (fs.existsSync(file)) await c.query(fs.readFileSync(file, 'utf8'));
      if (name === '20261005190000_add_owner_contact') {
        const existing = (await c.query('SELECT name,contact,"passwordHash" FROM "User" WHERE id=$1', ['contact-upgrade-user'])).rows[0];
        check('contact migration preserves existing users without inventing contact', existing.contact === null && existing.name === 'Existing User' && existing.passwordHash === 'unused-test-hash');
      }
    }
    const companyId = crypto.randomUUID(), companyUser = crypto.randomUUID();
    await c.query('INSERT INTO "User" (id,email,name,"passwordHash","updatedAt") VALUES ($1,$2,$3,$4,now())', [companyUser,'company@example.invalid','Company Owner',await bcrypt.hash(password,10)]);
    await c.query('INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())', [companyId,companyUser,'Company','COMPANY','Maharashtra','Mumbai',400001,'Test company address']);
    await c.query('INSERT INTO "Membership" (id,"userId","organizationId",role,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,now())', [crypto.randomUUID(),companyUser,companyId,'OWNER','ACTIVE']);
    // Reproduce the live revert; only this new local database is altered.
    await c.query('ALTER TABLE "Organization" DROP COLUMN "gstNumber", DROP COLUMN "phone", DROP COLUMN "country", DROP COLUMN "isActive", DROP COLUMN "accessVersion"');
    if (!baseline) await c.query(repair);
    const { default: app } = await import(pathToFileURL(path.join(root, 'apps/api/src/app.ts')).href);
    ({ prisma } = await import(pathToFileURL(path.join(root, 'apps/api/src/utils/db.ts')).href));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function http(route, actor, body, method = 'POST') {
      const r = await fetch(base + route, { method, headers: { ...(actor ? { Cookie: actor } : {}), ...(body ? { 'Content-Type':'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status:r.status, body:await r.json(), cookies:r.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ') };
    }
    const companyLogin = await http('/api/auth/login', null, { email:'company@example.invalid',password });
    check('existing Company login', companyLogin.status === 200);
    const invite = await http('/api/members/generateInviteCode', companyLogin.cookies);
    check('Company invitation', invite.status === 201);
    const data = { orgName:'Distributor',ownerName:'Distributor Owner',ownerEmail:'distributor@example.invalid',ownerContact:'9000000000',orgType:'DISTRIBUTOR',inviteCode:invite.body.data.inviteCode,state:'Maharashtra',city:'Mumbai',pincode:400001,address:'Test distributor address',gstNumber:'TEST-GST',phone:'9999999999',country:'India' };
    const created = await http('/api/auth/register', companyLogin.cookies, data);
    if (baseline) {
      check('baseline registration fails on reverted schema', created.status === 500);
      const undo = new Error('rollback probe');
      let probeCode;
      try { await prisma.$transaction(async tx => { await tx.organization.create({ data: { name:'Probe',type:'PARTNER',state:'Maharashtra',city:'Mumbai',pincode:400001,address:'Probe address',ownerId:companyUser },select:{id:true,name:true,type:true} }); throw undo; }); }
      catch(e) { probeCode = e === undo ? 'explicit-select-succeeds' : e.code; }
      console.log('Core fields plus explicit select:', probeCode);
      return;
    }
    check('Distributor registration succeeds', created.status === 201);
    const registered = await prisma.organization.findUniqueOrThrow({ where:{id:created.body.data.organization.id} });
    check('registration profile fields persisted', registered.gstNumber === data.gstNumber && registered.phone === data.phone && registered.country === data.country);
    const actors = {};
    let sequence = 0;
    let contactSequence = 0;
    const ctx = {
      prisma, sql:c, auditUrl:url, mails, actors, password,
      next:()=>++sequence, setFailMail:value=>{failMail=value;},
      check, record:(label,details)=>check(label,details.pass !== false),
      registration:(label,type='DISTRIBUTOR')=>({orgName:label,ownerName:label,ownerEmail:label+'@example.invalid',ownerContact:String(9100000000 + ++contactSequence),orgType:type,state:'Maharashtra',city:'Mumbai',pincode:400001,address:'Auth test address'}),
      async http(label,actor,method,route,body,expected) {
        const r = await http(route,actor?.cookie,body,method);
        if (expected !== undefined) check(label, (Array.isArray(expected)?expected:[expected]).includes(r.status));
        return {status:r.status,data:r.body,cookies:r.cookies};
      },
      async login(label,email,pass=password) {
        const r=await http('/api/auth/login',null,{email,password:pass});check('login '+label,r.status===200);
        const user=await prisma.user.findUniqueOrThrow({where:{email},include:{membership:{include:{organization:true}}}});
        return actors[label]={label,email,cookie:r.cookies,userId:user.id,orgId:user.membership.organizationId,type:user.membership.organization.type,role:user.membership.role};
      },
      async fixture(label,type,orgId,role='OWNER',status='ACTIVE') {
        if(label==='auth-company')return ctx.login(label,'company@example.invalid');
        const user=await prisma.user.create({data:{name:label,email:label.toLowerCase()+'@example.invalid',passwordHash:await bcrypt.hash(password,4)}});
        if(!orgId)orgId=(await prisma.organization.create({data:{name:label,type,ownerId:user.id,state:'Maharashtra',city:'Mumbai',pincode:400001,address:'Auth fixture address'}})).id;
        await prisma.membership.create({data:{userId:user.id,organizationId:orgId,role,status}});
        return ctx.login(label,user.email);
      },
      async invite(parent) {
        const r=await http('/api/members/generateInviteCode',parent.cookie);check('generate Company invite',r.status===201);return r.body.data.inviteCode;
      },
      async register(label,parent,type='DISTRIBUTOR',extra={}) {
        const input={...ctx.registration(label,type),...(type==='DISTRIBUTOR'?{inviteCode:await ctx.invite(parent)}:{}),...extra};
        const r=await http('/api/auth/register',parent.cookie,input);check('register '+label,r.status===201);
        const temporary=mails.findLast(message=>message.To[0].Email===input.ownerEmail)?.TextPart.match(/Temporary Password:\s*([^\s]+)/)?.[1];
        assert.ok(temporary,'captured credentials exist');return ctx.login(label,input.ownerEmail,temporary);
      },
    };
    ctx.company = await ctx.login('existing-company','company@example.invalid');
    for(const phase of ['auth_flow','distributor_invites','member_invites','owner_contact','revenue']) {
      const module=await import(pathToFileURL(path.join(root,'audits/distributor-lifecycle/harness/phases',phase+'.ts')).href);
      await module.run(ctx);
    }
    await prisma.organization.update({where:{id:registered.id},data:{isActive:false,accessVersion:7}});
    const beforeRepeat=await prisma.organization.findUniqueOrThrow({where:{id:registered.id}});
    await c.query(repair);
    check('repeat migration preserves profiles and deactivated access', JSON.stringify(await prisma.organization.findUniqueOrThrow({where:{id:registered.id}}))===JSON.stringify(beforeRepeat));
    const oldPassword=mails.find(message=>message.To[0].Email===data.ownerEmail).TextPart.match(/Temporary Password:\s*([^\s]+)/)[1];
    check('inactive Distributor still cannot login', (await http('/api/auth/login',null,{email:data.ownerEmail,password:oldPassword})).status===403);
    completed = true;
  } finally {
    if (server) await new Promise(resolve=>server.close(resolve));
    if (prisma) await prisma.$disconnect(); await c.end();
    fs.writeFileSync(path.join(__dirname, baseline ? 'baseline.json' : 'verification.json'), JSON.stringify({ checkedAt:new Date().toISOString(),database,migration:repairName,checksum:crypto.createHash('sha256').update(repair).digest('hex'),completed,results,noOnlineWrites:true,noExternalEmail:true },null,2));
  }
}
main().catch(error=>{console.error('Auth verification failed:',error.code || error.message);process.exitCode=1;});
