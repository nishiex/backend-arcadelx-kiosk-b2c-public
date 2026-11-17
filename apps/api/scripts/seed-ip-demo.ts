import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const SOURCE_KEY = 'demo-arcadelx-productions';
const OWNER_EMAIL = 'demo-ip-owner@arcadelx.local';
const BUSINESS_DATE = new Date('2026-11-16T00:00:00.000Z');
const DEMO_PASSWORD = process.env.DEMO_IP_PASSWORD;

async function main() {
  if (!DEMO_PASSWORD) throw new Error('Set DEMO_IP_PASSWORD in the environment before running this demo seed.');
  const { prisma } = await import('../src/utils/db');
  try {
    const company = await prisma.organization.findFirst({ where: { type: 'COMPANY' }, select: { id: true } });
  if (!company) throw new Error('No COMPANY organization exists. Run the normal local/company seed first.');

    const result = await prisma.$transaction(async tx => {
    let owner = await tx.user.findUnique({ where: { email: OWNER_EMAIL }, select: { id: true } });
    if (!owner) {
      owner = await tx.user.create({
        data: {
          email: OWNER_EMAIL,
          name: 'Demo IP Owner',
          contact: '9999999991',
          passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
          mustChangePassword: false,
        },
        select: { id: true },
      });
    }

    let profile = await tx.ipProfile.findUnique({ where: { sourceKey: SOURCE_KEY }, select: { organizationId: true } });
    let ipOrgId = profile?.organizationId;
    if (!ipOrgId) {
      const org = await tx.organization.create({
        data: {
          name: 'Demo ArcadeLX Productions', type: 'IP_PARTY', ownerId: owner.id,
          state: 'Maharashtra', city: 'Mumbai', pincode: 400001,
          address: 'Demo address for IP dashboard testing', country: 'India',
        },
        select: { id: true },
      });
      ipOrgId = org.id;
      await tx.membership.upsert({
        where: { userId: owner.id },
        update: { organizationId: ipOrgId, role: 'OWNER', status: 'ACTIVE' },
        create: { userId: owner.id, organizationId: ipOrgId, role: 'OWNER', status: 'ACTIVE' },
      });
      profile = await tx.ipProfile.create({
        data: { organizationId: ipOrgId, sourceKey: SOURCE_KEY, legalName: 'Demo ArcadeLX Productions Pvt Ltd', pan: 'DEMO1234A', gstin: '27DEMO1234A1Z5', statementEmail: OWNER_EMAIL },
        select: { organizationId: true },
      });
    }

    const activeAgreement = await tx.ipAgreement.findFirst({ where: { organizationId: ipOrgId, status: 'ACTIVE' }, select: { id: true } });
    if (!activeAgreement) await tx.ipAgreement.create({ data: { organizationId: ipOrgId, companyOrganizationId: company.id, ipSharePct: 60, companySharePct: 40, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE' } });

    const gameA = await tx.ipGame.upsert({ where: { gameIdentifier: 'demo-space-racer' }, update: { organizationId: ipOrgId, displayName: 'Demo Space Racer', status: 'ACTIVE' }, create: { organizationId: ipOrgId, gameIdentifier: 'demo-space-racer', displayName: 'Demo Space Racer', status: 'ACTIVE' } });
    const gameB = await tx.ipGame.upsert({ where: { gameIdentifier: 'demo-jungle-quest' }, update: { organizationId: ipOrgId, displayName: 'Demo Jungle Quest', status: 'ACTIVE' }, create: { organizationId: ipOrgId, gameIdentifier: 'demo-jungle-quest', displayName: 'Demo Jungle Quest', status: 'ACTIVE' } });

    const rows = [
      { game: gameA, gross: 12500, gst: 2250, pg: 250, network: 1000, company: 9000, royalty: 5400, kiosks: 4 },
      { game: gameB, gross: 8000, gst: 1440, pg: 160, network: 640, company: 5760, royalty: 3456, kiosks: 3 },
    ];
    for (const row of rows) {
      await tx.ipDailyGameRevenue.upsert({ where: { organizationId_businessDate_gameIdentifier: { organizationId: ipOrgId, businessDate: BUSINESS_DATE, gameIdentifier: row.game.gameIdentifier } }, update: { ipGameId: row.game.id, gameDisplayName: row.game.displayName, kioskCount: row.kiosks, grossRevenue: row.gross, gstAmount: row.gst, pgFeeAmount: row.pg, networkShare: row.network, companyShareBeforeRoyalty: row.company, ipRoyaltyShare: row.royalty }, create: { organizationId: ipOrgId, ipGameId: row.game.id, businessDate: BUSINESS_DATE, gameIdentifier: row.game.gameIdentifier, gameDisplayName: row.game.displayName, kioskCount: row.kiosks, grossRevenue: row.gross, gstAmount: row.gst, pgFeeAmount: row.pg, networkShare: row.network, companyShareBeforeRoyalty: row.company, ipRoyaltyShare: row.royalty } });
    }
    await tx.ipDailyPartySummary.upsert({ where: { organizationId_businessDate: { organizationId: ipOrgId, businessDate: BUSINESS_DATE } }, update: { kioskCount: 7, grossRevenue: 20500, gstAmount: 3690, pgFeeAmount: 410, networkShare: 1640, companyShareBeforeRoyalty: 14760, ipRoyaltyShare: 8856 }, create: { organizationId: ipOrgId, businessDate: BUSINESS_DATE, kioskCount: 7, grossRevenue: 20500, gstAmount: 3690, pgFeeAmount: 410, networkShare: 1640, companyShareBeforeRoyalty: 14760, ipRoyaltyShare: 8856 } });
    await tx.ipDailyRevenueJobRun.create({ data: { businessDate: BUSINESS_DATE, status: 'COMPLETED', startedAt: new Date('2026-11-16T18:30:00.000Z'), completedAt: new Date('2026-11-16T18:35:00.000Z'), partiesDiscovered: 1, partiesProcessed: 1, batchesTotal: 1, batchesSuccessful: 1, splitsConsidered: 2, recordsCreatedOrUpdated: 2, metadata: { demoSeed: true } } });
    for (const row of rows) {
      for (let kiosk = 1; kiosk <= row.kiosks; kiosk++) {
        await tx.ipDailyGameKiosk.upsert({ where: { organizationId_businessDate_gameIdentifier_kioskId: { organizationId: ipOrgId, businessDate: BUSINESS_DATE, gameIdentifier: row.game.gameIdentifier, kioskId: `DEMO-IP-KIOSK-${kiosk}` } }, update: {}, create: { organizationId: ipOrgId, businessDate: BUSINESS_DATE, gameIdentifier: row.game.gameIdentifier, kioskId: `DEMO-IP-KIOSK-${kiosk}` } });
      }
    }

    const settlement = await tx.ipSettlement.upsert({ where: { organizationId_month_year: { organizationId: ipOrgId, month: 11, year: 2026 } }, update: { grossRevenue: 20500, gstAmount: 3690, pgFeeAmount: 410, networkShare: 1640, companyShareBeforeRoyalty: 14760, ipRoyaltyShare: 8856, finalPayout: 8856, totalKioskCount: 7, status: 'GENERATED' }, create: { organizationId: ipOrgId, month: 11, year: 2026, grossRevenue: 20500, gstAmount: 3690, pgFeeAmount: 410, networkShare: 1640, companyShareBeforeRoyalty: 14760, ipRoyaltyShare: 8856, finalPayout: 8856, totalKioskCount: 7, status: 'GENERATED' } });
    await tx.ipSettlementLine.deleteMany({ where: { settlementId: settlement.id } });
    for (const row of rows) await tx.ipSettlementLine.create({ data: { settlementId: settlement.id, ipGameId: row.game.id, gameIdentifier: row.game.gameIdentifier, gameDisplayName: row.game.displayName, kioskCount: row.kiosks, grossRevenue: row.gross, gstAmount: row.gst, pgFeeAmount: row.pg, networkShare: row.network, companyShareBeforeRoyalty: row.company, ipRoyaltyShare: row.royalty } });
    return { ipOrgId, ownerEmail: OWNER_EMAIL, sourceKey: SOURCE_KEY, games: rows.length, settlementId: settlement.id };
  });
    console.log(JSON.stringify(result, null, 2));
  } finally { await prisma.$disconnect(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
