import { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../utils/db';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiResponse } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import { MothershipPaymentsQuerySchema, SettingsSchema, RevenueSeriesQuerySchema } from '@shared-types/validationSchemas/Revenue/revenue.validation';
import { indiaCalendar, revenueMonth } from '../../services/Revenue/revenue-period';
import { RANGE_CONFIG, bucketKey, bucketLabel, rangeBuckets, rangeFilterStart, sqlBucket } from '../../services/Revenue/revenue-series';
import { getMothershipPayments, syncRevenueData } from '../../services/Revenue/revenueTransaction.services';
import { syncDevices } from '../../services/Revenue/deviceSync.service';
import { mothershipPaymentsCsv, mothershipPaymentsPdf, type MothershipPaymentExportRow } from '../../services/Revenue/mothership-payment-export';

let revenueSyncInFlight: Promise<{ devices: Awaited<ReturnType<typeof syncDevices>> | null; transactions: Awaited<ReturnType<typeof syncRevenueData>> }> | null = null;

async function enrichPaymentExportRows(payments: Awaited<ReturnType<typeof getMothershipPayments>>['payments']): Promise<MothershipPaymentExportRow[]> {
  const identifiers = [...new Set(payments.map((payment) => payment.device_id).filter(Boolean))];
  const baseRows = payments.map((payment) => ({ ...payment, payment_date: payment.created_at.slice(0, 10), distributor_name: null, partner_name: null }));
  if (!identifiers.length) return baseRows;
  try {
    const kiosks = await prisma.kiosk.findMany({
      where: { OR: [{ externalDeviceId: { in: identifiers } }, { machineCode: { in: identifiers } }] },
      select: { externalDeviceId: true, machineCode: true, currentOrg: { select: { name: true, type: true } }, assignments: { select: { assignedFrom: true, assignedTo: true, organization: { select: { name: true, type: true } } } } },
    });
    const byIdentifier = new Map<string, (typeof kiosks)[number]>();
    for (const kiosk of kiosks) { if (kiosk.externalDeviceId) byIdentifier.set(kiosk.externalDeviceId, kiosk); byIdentifier.set(kiosk.machineCode, kiosk); }
    return baseRows.map((payment) => {
      const kiosk = byIdentifier.get(payment.device_id), occurredAt = new Date(payment.created_at);
      const assignment = kiosk?.assignments.filter((row) => row.assignedFrom <= occurredAt && (row.assignedTo === null || row.assignedTo > occurredAt)).sort((a, b) => b.assignedFrom.getTime() - a.assignedFrom.getTime())[0];
      const organization = assignment?.organization ?? kiosk?.currentOrg;
      return { ...payment, distributor_name: organization?.type === 'DISTRIBUTOR' ? organization.name : null, partner_name: organization?.type === 'PARTNER' ? organization.name : null };
    });
  } catch { return baseRows; }
}

export const getMothershipPaymentsFeed = asyncHandler(async (req, res) => {
  const { page, pageSize } = MothershipPaymentsQuerySchema.parse(req.query);
  const format = typeof req.query.format === 'string' ? req.query.format.toLowerCase() : 'json';
  if (!['json', 'csv', 'pdf'].includes(format)) throw new ApiError(400, 'format must be json, csv, or pdf');
  const result = await getMothershipPayments();

  // This endpoint is already restricted to Company Owners/Admins by the router.
  // Mothership owns the fleet-wide feed, so do not filter it through local kiosk
  // ownership mappings: an unsynced or renamed local device must not make a healthy
  // upstream payment feed appear empty in production.
  const payments = result.payments
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const enrichedPayments = await enrichPaymentExportRows(payments);
  const total = payments.length;
  if (format === 'csv') { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="mothership-payments.csv"'); return res.send(mothershipPaymentsCsv(enrichedPayments)); }
  if (format === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', 'attachment; filename="mothership-payments.pdf"'); return res.send(await mothershipPaymentsPdf(enrichedPayments)); }
  const pagePayments = enrichedPayments.slice((page - 1) * pageSize, page * pageSize);
  res.json(
    new ApiResponse(
      200,
      {
        ...result,
        total,
        payments: pagePayments,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
      'Mothership payments fetched successfully',
    ),
  );
});

/** Import the current Mothership feed into the local revenue ledger on demand. */
export const syncMothershipPayments = asyncHandler(async (_req, res) => {
  if (!revenueSyncInFlight) {
    revenueSyncInFlight = (async () => {
      const devices = await syncDevices();
      return { devices, transactions: await syncRevenueData() };
    })().finally(() => {
      revenueSyncInFlight = null;
    });
  }
  const result = await revenueSyncInFlight;
  res.json(new ApiResponse(200, result, 'Mothership payments synchronized successfully'));
});

export const getMachineWiseRevenue = asyncHandler(async (req, res) => {
  const orgId = req.membership!.organizationId, orgType = req.membership!.type;
  const now = new Date(), calendar = indiaCalendar(now);
  const today = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day) - 330 * 60000);
  const monthStart = revenueMonth(calendar.month, calendar.year).start;
  const agreements = orgType === 'DISTRIBUTOR' ? await prisma.agreement.findMany({ where: { parentOrgId: orgId, status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { childOrgId: true, effectiveFrom: true, effectiveTo: true } }) : [];
  const orgIds = [orgId, ...agreements.map(a => a.childOrgId)];
  const assignments = await prisma.kioskAssignment.findMany({
    where: orgType === 'COMPANY' ? {} : { organizationId: { in: orgIds } },
    include: { organization: { select: { name: true, type: true, childAgreements: { where: { status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { effectiveFrom: true, effectiveTo: true, parentOrg: { select: { name: true, type: true } } } } } }, kiosk: { select: { machineCode: true, location: true, transactions: { where: { occurredAt: { lte: now } }, select: { id: true, amount: true, currency: true, occurredAt: true } } } } },
    orderBy: [{ assignedFrom: 'desc' }, { id: 'asc' }],
  });
  type Row = { machineCode: string; location: string; distributor: string; partner: string; deployedPartner: string; today: number; thisMonth: number; totalRevenue: number };
  const rows = new Map<string, Row>(), seen = new Set<string>();
  for (const assignment of assignments) {
    const code = assignment.kiosk.machineCode;
    const displayDate = assignment.assignedTo ? new Date(assignment.assignedTo.getTime() - 1) : now;
    const parent = assignment.organization.childAgreements.find(a => a.parentOrg.type === 'DISTRIBUTOR' && a.effectiveFrom <= displayDate && (!a.effectiveTo || displayDate < a.effectiveTo));
    const row = rows.get(code) ?? { machineCode: code, location: assignment.kiosk.location || '-', distributor: assignment.organization.type === 'DISTRIBUTOR' ? assignment.organization.name : parent?.parentOrg.name ?? '-', partner: assignment.organization.type === 'PARTNER' ? assignment.organization.name : '-', deployedPartner: assignment.organization.type === 'PARTNER' ? assignment.organization.name : '-', today: 0, thisMonth: 0, totalRevenue: 0 };
    for (const payment of assignment.kiosk.transactions) {
      const date = payment.occurredAt;
      if (date < assignment.assignedFrom || (assignment.assignedTo && date >= assignment.assignedTo)) continue;
      if (orgType === 'DISTRIBUTOR' && assignment.organizationId !== orgId && !agreements.some(a => a.childOrgId === assignment.organizationId && a.effectiveFrom <= date && (!a.effectiveTo || date < a.effectiveTo))) continue;
      if (seen.has(payment.id)) throw new ApiError(409, 'Overlapping kiosk assignment history');
      if (payment.currency !== 'INR') throw new ApiError(409, 'Revenue reporting requires INR transactions');
      seen.add(payment.id);
      row.totalRevenue = new Prisma.Decimal(row.totalRevenue).plus(payment.amount).toNumber();
      if (date >= monthStart) row.thisMonth = new Prisma.Decimal(row.thisMonth).plus(payment.amount).toNumber();
      if (date >= today) row.today = new Prisma.Decimal(row.today).plus(payment.amount).toNumber();
    }
    rows.set(code, row);
  }
  res.json(new ApiResponse(200, { kiosks: [...rows.values()] }, 'Machine-wise revenue fetched successfully'));
});
const defaults = { id: 'default', gstPercentage: 0, pgFeePercentage: 2.5, tdsPercentage: 2 };
/**
 * Revenue trend for the dashboard chart.
 *
 * Read-only and additive. It applies exactly the same organization scoping and
 * assignment/INR filters as `getMachineWiseRevenue` above, so the two endpoints
 * always agree for the same window; it only groups the payments into IST buckets
 * (day, ISO week, or month) instead of summing them per machine/today/month.
 */
export const getRevenueSeries = asyncHandler(async (req, res) => {
  const { range } = RevenueSeriesQuerySchema.parse(req.query);
  const orgId = req.membership!.organizationId, orgType = req.membership!.type;
  const now = new Date();
  const bucket = sqlBucket(range);
  const from = rangeFilterStart(range, now);
  // Same scoping as machine-wise: a Distributor also covers its Partner children
  // while the governing agreement is in force.
  const agreements = orgType === 'DISTRIBUTOR' ? await prisma.agreement.findMany({ where: { parentOrgId: orgId, status: { in: ['ACTIVE', 'TERMINATED'] } }, select: { childOrgId: true, effectiveFrom: true, effectiveTo: true } }) : [];
  const orgIds = [orgId, ...agreements.map(a => a.childOrgId)];
  const assignments = await prisma.kioskAssignment.findMany({
    where: orgType === 'COMPANY' ? {} : { organizationId: { in: orgIds } },
    select: { organizationId: true, assignedFrom: true, assignedTo: true, kiosk: { select: { transactions: { where: { occurredAt: { gte: from, lte: now } }, select: { id: true, amount: true, currency: true, occurredAt: true } } } } },
    orderBy: [{ assignedFrom: 'desc' }, { id: 'asc' }],
  });
  const totals = new Map<string, number>(), seen = new Set<string>();
  for (const assignment of assignments) {
    for (const payment of assignment.kiosk.transactions) {
      const date = payment.occurredAt;
      // The payment must belong to this organization's assignment window...
      if (date < assignment.assignedFrom || (assignment.assignedTo && date >= assignment.assignedTo)) continue;
      // ...and, for a Distributor, to its own organization or a governed Partner.
      if (orgType === 'DISTRIBUTOR' && assignment.organizationId !== orgId && !agreements.some(a => a.childOrgId === assignment.organizationId && a.effectiveFrom <= date && (!a.effectiveTo || date < a.effectiveTo))) continue;
      if (seen.has(payment.id)) throw new ApiError(409, 'Overlapping kiosk assignment history');
      if (payment.currency !== 'INR') throw new ApiError(409, 'Revenue reporting requires INR transactions');
      seen.add(payment.id);
      // Bucket the payment into its IST day/week/month.
      const key = bucketKey(date, bucket);
      totals.set(key, new Prisma.Decimal(totals.get(key) ?? 0).plus(payment.amount).toNumber());
    }
  }
  // Every bucket in the range is returned, so gaps chart as zero.
  const points = rangeBuckets(range, now).map(start => {
    const key = start.toISOString().slice(0, 10);
    return { key, label: bucketLabel(start, bucket), revenue: totals.get(key) ?? 0 };
  });
  const total = points.reduce((sum, point) => new Prisma.Decimal(sum).plus(point.revenue).toNumber(), 0);
  res.json(new ApiResponse(200, { range, granularity: RANGE_CONFIG[range].granularity, bucket, currency: 'INR', total, points }, 'Revenue series fetched successfully'));
});
export const getSystemSettings = asyncHandler(async (_req, res) => {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  res.json(new ApiResponse(200, { settings: settings ?? defaults }));
});
export const updateSystemSettings = asyncHandler(async (req, res) => {
  const input = SettingsSchema.parse(req.body);
  const settings = await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext($1))', 'revenue-system-settings');
    const current = await tx.systemSettings.findUnique({ where: { id: 'default' } });
    const rates = { gstPercentage: 0, pgFeePercentage: input.pgFeePercentage ?? Number(current?.pgFeePercentage ?? 2.5), tdsPercentage: input.tdsPercentage ?? Number(current?.tdsPercentage ?? 2) };
    return tx.systemSettings.upsert({ where: { id: 'default' }, update: rates, create: { id: 'default', ...rates } });
  });
  res.json(new ApiResponse(200, { settings }, 'System financial settings updated successfully'));
});
