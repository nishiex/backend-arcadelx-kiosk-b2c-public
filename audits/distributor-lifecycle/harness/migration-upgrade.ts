// Only creates new databases on the documented local Docker PostgreSQL.
// Leaves every existing database and every historical migration unchanged.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migrationDir = path.join(root, 'apps/api/prisma/migrations');
const target = '20260929100000_protect_distributor_lifecycle';
const url = new URL('postgresql://postgres@localhost:5433/arcadelx');
url.password = execFileSync('docker', ['exec','arcadelx-pg','printenv','POSTGRES_PASSWORD'], {encoding:'utf8'}).trim();
const stamp = new Date().toISOString().replace(/\D/g, '');
const out = path.join(root, 'audits/distributor-lifecycle', `migration-${stamp}.json`);
const results: any[] = [];
const admin = new pg.Client({connectionString:url.href});
await admin.connect();
const fixture = `
  INSERT INTO "User" (id,email,"passwordHash",name,"updatedAt") VALUES ('u','upgrade@example.invalid','fixture-unusable','Upgrade',now());
  INSERT INTO "Organization" (id,"ownerId",name,type,state,city,pincode,address,"updatedAt") VALUES
    ('c','u','Company','COMPANY','State','City',400001,'Address',now()),
    ('d','u','Distributor','DISTRIBUTOR','State','City',400001,'Address',now());
  INSERT INTO "NetworkConnection" (id,"initiatorOrgId","receiverOrgId",status,"updatedAt") VALUES ('n','c','d','ACTIVE',now());
  INSERT INTO "Agreement" (id,"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct","effectiveFrom",status,"depositAmountPerMachine","nonRefundableAmountPerMachine","updatedAt")
    VALUES ('a','n','c','d',60,40,now(),'ACTIVE',1000,200,now());
  INSERT INTO "Order" (id,"orderNumber",type,status,"parentOrgId","childOrgId","agreementId",quantity,"depositPerMachine","nonRefundablePerMachine","totalDeposit","totalNonRefundable","taxAmount","grandTotal","invoiceUrl","updatedAt")
    VALUES ('o','ORD-2026-00042','ALLOCATION','APPROVED','c','d','a',1,1000,200,1000,200,36,1236,'/orders/o/invoice',now()),
    ('old','ORD-2025-00099','ALLOCATION','DELIVERED','c','d','a',1,1000,200,1000,200,36,1236,'/orders/old/invoice',now());
  INSERT INTO "Kiosk" (id,"machineCode",model,status,"currentOrgId","updatedAt") VALUES
    ('k','UPGRADE-1','Model','RESERVED','c',now()), ('old-k','UPGRADE-2','Model','AVAILABLE','d',now());
  INSERT INTO "OrderKiosk" ("orderId","kioskId") VALUES ('o','k'),('old','old-k');
  INSERT INTO "KioskAssignment" (id,"kioskId","organizationId","assignedById") VALUES ('history','k','c','u'),('old-history','old-k','d','u');
`;
const cases = [
  {name:'valid', sql:'', code:null},
  {name:'duplicate_network',sql:`INSERT INTO "NetworkConnection" (id,"initiatorOrgId","receiverOrgId","updatedAt") VALUES ('n2','d','c',now());`,code:'23505'},
  {name:'duplicate_agreement',sql:`INSERT INTO "Agreement" SELECT 'a2',"networkConnectionId","parentOrgId","childOrgId","parentSharePct","childSharePct","effectiveFrom","effectiveTo",status,"pdfUrl","createdAt","updatedAt","depositAmountPerMachine","nonRefundableAmountPerMachine" FROM "Agreement" WHERE id='a';`,code:'23505'},
  {name:'duplicate_history',sql:`INSERT INTO "KioskAssignment" (id,"kioskId","organizationId","assignedById") VALUES ('history2','k','c','u');`,code:'23505'},
  {name:'ambiguous_stock',sql:`UPDATE "Order" SET status='APPROVED',quantity=2 WHERE id='old'; INSERT INTO "OrderKiosk" ("orderId","kioskId") VALUES ('old','k');`,code:'P0001'},
  {name:'stale_owner',sql:`UPDATE "Kiosk" SET "currentOrgId"='d' WHERE id='k';`,code:'P0001'},
  {name:'incomplete_order',sql:`UPDATE "Order" SET quantity=2 WHERE id='o';`,code:'P0001'},
  {name:'orphan_reservation',sql:`INSERT INTO "Kiosk" (id,"machineCode",model,status,"currentOrgId","updatedAt") VALUES ('orphan','UPGRADE-3','Model','RESERVED','c',now());`,code:'23514'},
];
try {
  for (let index=0; index<cases.length; index++) {
    const test=cases[index];
    const database=`arcadelx_upgrade_${stamp}_${index}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    const testUrl=new URL(url.href); testUrl.pathname='/'+database;
    const sql=new pg.Client({connectionString:testUrl.href}); await sql.connect();
    try {
      for(const name of fs.readdirSync(migrationDir).sort().filter(name=>name<target)) {
        const file=path.join(migrationDir,name,'migration.sql');
        if(fs.existsSync(file)) await sql.query(fs.readFileSync(file,'utf8'));
      }
      await sql.query(fixture);
      await sql.query(test.sql);
      const before=(await sql.query(`SELECT (SELECT count(*) FROM "KioskAssignment") AS history, (SELECT count(*) FROM "Order") AS orders, (SELECT count(*) FROM "Kiosk") AS kiosks`)).rows[0];
      let errorCode:string|null=null;
      try { await sql.query(fs.readFileSync(path.join(migrationDir,target,'migration.sql'),'utf8')); }
      catch(error:any) {
        errorCode=error.code;
        await sql.query('ROLLBACK');
        if(test.name==='ambiguous_stock') assert.match(error.message,/Multiple active orders reference the same kiosk/);
      }
      assert.equal(errorCode,test.code,test.name);
      const after=(await sql.query(`SELECT (SELECT count(*) FROM "KioskAssignment") AS history, (SELECT count(*) FROM "Order") AS orders, (SELECT count(*) FROM "Kiosk") AS kiosks`)).rows[0];
      assert.deepEqual(after,before,'No historical or business records deleted');
      if(test.code) {
        assert.equal((await sql.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Organization' AND column_name='gstNumber'`)).rowCount,0,'DDL fully rolled back');
        assert.equal((await sql.query(`SELECT "invoiceUrl" FROM "Order" WHERE id='o'`)).rows[0].invoiceUrl,'/orders/o/invoice');
      } else {
        assert.equal((await sql.query(`SELECT "reservedOrderId" FROM "Kiosk" WHERE id='k'`)).rows[0].reservedOrderId,'o');
        assert.equal((await sql.query(`SELECT "reservedOrderId" FROM "Kiosk" WHERE id='old-k'`)).rows[0].reservedOrderId,null);
        assert.deepEqual((await sql.query(`SELECT year,value FROM "OrderSequence" ORDER BY year`)).rows,[{year:2025,value:99},{year:2026,value:42}]);
        assert.equal((await sql.query(`INSERT INTO "OrderSequence" (year,value) VALUES (2026,1) ON CONFLICT (year) DO UPDATE SET value="OrderSequence".value+1 RETURNING value`)).rows[0].value,43);
        assert.equal((await sql.query(`SELECT "invoiceUrl" FROM "Order" WHERE id='o'`)).rows[0].invoiceUrl,'/api/orders/o/invoice');
        assert.deepEqual((await sql.query(`SELECT "gstNumber",phone,country FROM "Organization" WHERE id='d'`)).rows[0],{gstNumber:null,phone:null,country:null});
      }
      results.push({case:test.name,database,passed:true,errorCode,before,after});
      console.log(test.name+' PASS');
    } finally { await sql.end(); }
  }
} catch(error:any) { results.push({passed:false,message:error.message}); process.exitCode=1; }
finally { await admin.end(); fs.writeFileSync(out,JSON.stringify({target,results},null,2)); console.log(out); }
