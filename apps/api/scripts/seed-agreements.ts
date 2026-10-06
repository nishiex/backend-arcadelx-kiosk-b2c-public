// Seed ACTIVE network connections + ACTIVE agreements for all orgs without them.
// Run: npx tsx scripts/seed-agreements.ts
import { prisma } from '../src/utils/db';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

async function main() {
  const company = await prisma.organization.findFirstOrThrow({ where: { type: 'COMPANY' } });
  console.log(`Company: ${company.name} (${company.id})`);

  const others = await prisma.organization.findMany({
    where: { type: { in: ['DISTRIBUTOR', 'PARTNER'] } },
  });

  for (const org of others) {
    console.log(`\n→ Processing ${org.name} (${org.type})`);

    // Ensure ACTIVE network connection exists
    let conn = await prisma.networkConnection.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [
          { initiatorOrgId: company.id, receiverOrgId: org.id },
          { initiatorOrgId: org.id, receiverOrgId: company.id },
        ],
      },
    });
    if (!conn) {
      conn = await prisma.networkConnection.create({
        data: { initiatorOrgId: company.id, receiverOrgId: org.id, status: 'ACTIVE' },
      });
      console.log(`  🔗 Created network connection ${conn.id}`);
    } else {
      console.log(`  🔗 Network connection already exists ${conn.id}`);
    }

    // Ensure ACTIVE agreement exists
    const existingAg = await prisma.agreement.findFirst({
      where: { parentOrgId: company.id, childOrgId: org.id, status: 'ACTIVE' },
    });
    if (existingAg) {
      console.log(`  ✅ Active agreement already exists — skipping`);
      continue;
    }

    const ag = await prisma.agreement.create({
      data: {
        networkConnectionId: conn.id,
        parentOrgId: company.id,
        childOrgId: org.id,
        parentSharePct: 60,
        childSharePct: 40,
        depositAmountPerMachine: 50000,
        nonRefundableAmountPerMachine: 10000,
        status: 'ACTIVE',
        effectiveFrom: new Date(),
      },
    });
    console.log(`  📝 Created ACTIVE agreement ${ag.id}`);
  }

  console.log('\n✅ All done!');
}

main()
  .catch(e => { console.error('❌', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
