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

let revenueSyncInFlight: Promise<{ devices: Awaited<ReturnType<typeof syncDevices>> | null; transactions: Awaited<ReturnType<typeof syncRevenueData>> }> | null = null;

export const getMothershipPaymentsFeed = asyncHandler(async (req, res) => {
  const organizationId = req.membership!.organizationId;
  const { page, pageSize } = MothershipPaymentsQuerySchema.parse(req.query);
  const result = await getMothershipPayments();

  // The upstream feed is fleet-wide. Restrict it to devices currently owned by
  // this Company before returning it. Historical assignments are intentionally
  // excluded: a transferred kiosk must not remain visible in the live feed.
  const kiosks = await prisma.kiosk.findMany({
    where: { currentOrgId: organizationId },
    select: { externalDeviceId: true, machineCode: true },
  });
  const allowedDeviceIds = new Set(
    kiosks.flatMap((kiosk) => [kiosk.externalDeviceId, kiosk.machineCode].filter(Boolean)),
  );
  const filteredPayments = result.payments
    .filter((payment) => allowedDeviceIds.has(payment.device_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const total = filteredPayments.length;
  const payments = filteredPayments.slice((page - 1) * pageSize, page * pageSize);
  res.json(
    new ApiResponse(
      200,
      {
        ...result,
        total,
        payments,
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
const defaults = { id: 'default', gstPercentage: 18, pgFeePercentage: 2.5, tdsPercentage: 2 };
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
    const rates = { gstPercentage: input.gstPercentage ?? Number(current?.gstPercentage ?? 18), pgFeePercentage: input.pgFeePercentage ?? Number(current?.pgFeePercentage ?? 2.5), tdsPercentage: input.tdsPercentage ?? Number(current?.tdsPercentage ?? 2) };
    if (new Prisma.Decimal(rates.gstPercentage).plus(rates.pgFeePercentage).gt(100)) throw new ApiError(400, 'GST plus payment gateway fees cannot exceed 100%');
    return tx.systemSettings.upsert({ where: { id: 'default' }, update: rates, create: { id: 'default', ...rates } });
  });
  res.json(new ApiResponse(200, { settings }, 'System financial settings updated successfully'));
});
