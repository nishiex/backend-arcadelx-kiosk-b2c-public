import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { generateRevenueStatement, type RevenueRow } from "../pdf/revenue.pdf";
import {
  attemptDelivery,
  queueRevenueStatement,
  revenueDeliveryKey,
} from "../email/delivery.service";
import { revenueMonth } from "./revenue-period";

export async function processRevenueStatement(
  targetOrgId: string,
  month: number,
  year: number,
) {
  const { start, end } = revenueMonth(month, year);
  const statementId = await prisma.$transaction(
    async (tx) => {
      // One statement and one durable email job even across workers or manual retries.
      await tx.$queryRawUnsafe(
        "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext($1))",
        "revenue:" + targetOrgId + ":" + year + ":" + month,
      );
      const existing = await tx.revenueStatement.findUnique({
        where: {
          organizationId_Month_Year: {
            organizationId: targetOrgId,
            Month: month,
            Year: year,
          },
        },
      });
      if (existing) {
        await queueRevenueStatement(tx, targetOrgId, existing.id);
        return existing.id;
      }
      const org = await tx.organization.findUnique({
        where: { id: targetOrgId },
        select: { id: true, name: true, type: true },
      });
      if (!org || org.type === "COMPANY") return null;
      const settings = await tx.systemSettings.findUnique({
        where: { id: "default" },
      });
      const gstRate = new Prisma.Decimal(settings?.gstPercentage ?? 18).div(
        100,
      );
      const pgRate = new Prisma.Decimal(settings?.pgFeePercentage ?? 2.5).div(
        100,
      );
      const tdsRate = new Prisma.Decimal(settings?.tdsPercentage ?? 2).div(100);
      if (gstRate.plus(pgRate).gt(1))
        throw new Error("GST and gateway deductions exceed revenue");
      const agreements = await tx.agreement.findMany({
        where: {
          status: { in: ["ACTIVE", "TERMINATED"] },
          effectiveFrom: { lt: end },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: start } }],
        },
        include: { parentOrg: { select: { type: true } } },
      });
      const at = (child: string, date: Date) => {
        const matches = agreements.filter(
          (a) =>
            a.childOrgId === child &&
            a.effectiveFrom <= date &&
            (!a.effectiveTo || date < a.effectiveTo),
        );
        if (matches.length !== 1)
          throw new Error(
            "Missing or overlapping historical revenue agreement",
          );
        return matches[0]!;
      };
      const children =
        org.type === "DISTRIBUTOR"
          ? agreements
              .filter((a) => a.parentOrgId === org.id)
              .map((a) => a.childOrgId)
          : [];
      const assignments = await tx.kioskAssignment.findMany({
        where: {
          organizationId: { in: [org.id, ...children] },
          assignedFrom: { lt: end },
          OR: [{ assignedTo: null }, { assignedTo: { gt: start } }],
        },
        include: {
          organization: { select: { type: true } },
          kiosk: {
            select: {
              machineCode: true,
              transactions: {
                where: { occurredAt: { gte: start, lt: end } },
                select: {
                  id: true,
                  amount: true,
                  currency: true,
                  occurredAt: true,
                },
              },
            },
          },
        },
      });
      const rows = new Map<string, RevenueRow>();
      const seen = new Set<string>();
      const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2);
      let parentOrgType: "COMPANY" | "DISTRIBUTOR" | undefined;
      for (const assignment of assignments) {
        for (const payment of assignment.kiosk.transactions) {
          if (
            payment.occurredAt < assignment.assignedFrom ||
            (assignment.assignedTo &&
              payment.occurredAt >= assignment.assignedTo)
          )
            continue;
          const agreement = at(assignment.organizationId, payment.occurredAt);
          if (
            org.type === "DISTRIBUTOR" &&
            assignment.organizationId !== org.id &&
            agreement.parentOrgId !== org.id
          )
            continue;
          if (seen.has(payment.id))
            throw new Error("Overlapping kiosk assignment history");
          seen.add(payment.id);
          if (payment.currency !== "INR" || payment.amount.lt(0))
            throw new Error("Unsupported currency or negative revenue");
          const gross = payment.amount,
            gst = money(gross.mul(gstRate)),
            pgFee = money(gross.mul(pgRate));
          const net = gross.minus(gst).minus(pgFee);
          let companyShare = new Prisma.Decimal(0),
            distributorShare = new Prisma.Decimal(0),
            partnerShare = new Prisma.Decimal(0);
          if (assignment.organization.type === "DISTRIBUTOR") {
            if (agreement.parentOrg.type !== "COMPANY")
              throw new Error("Invalid Distributor agreement");
            companyShare = money(net.mul(agreement.parentSharePct).div(100));
            distributorShare = net.minus(companyShare);
          } else if (assignment.organization.type === "PARTNER") {
            if (agreement.parentOrg.type === "COMPANY") {
              companyShare = money(net.mul(agreement.parentSharePct).div(100));
              partnerShare = net.minus(companyShare);
              parentOrgType = "COMPANY";
            } else if (agreement.parentOrg.type === "DISTRIBUTOR") {
              const upstream = at(agreement.parentOrgId, payment.occurredAt);
              if (upstream.parentOrg.type !== "COMPANY")
                throw new Error("Invalid upstream agreement");
              companyShare = money(net.mul(upstream.parentSharePct).div(100));
              distributorShare = money(
                net.minus(companyShare).mul(agreement.parentSharePct).div(100),
              );
              partnerShare = net.minus(companyShare).minus(distributorShare);
              parentOrgType = "DISTRIBUTOR";
            } else throw new Error("Invalid Partner agreement");
          }
          const share =
            org.type === "PARTNER" ? partnerShare : distributorShare;
          const tds = money(share.mul(tdsRate)),
            finalPayout = share.minus(tds);
          const amounts = {
            gross,
            gst,
            pgFee,
            net,
            companyShare,
            distributorShare,
            partnerShare,
            tds,
            finalPayout,
          };
          const code = assignment.kiosk.machineCode;
          const row = rows.get(code) ?? {
            machineCode: code,
            gross: 0,
            gst: 0,
            pgFee: 0,
            net: 0,
            companyShare: 0,
            distributorShare: 0,
            partnerShare: 0,
            tds: 0,
            finalPayout: 0,
          };
          for (const key of Object.keys(amounts) as (keyof typeof amounts)[])
            row[key] = new Prisma.Decimal(row[key])
              .plus(amounts[key])
              .toNumber();
          rows.set(code, row);
        }
      }
      if (!rows.size) return null;
      const data = [...rows.values()];
      const total = (key: Exclude<keyof RevenueRow, "machineCode">) =>
        data.reduce((sum, row) => sum.plus(row[key]), new Prisma.Decimal(0));
      const pdfPath = await generateRevenueStatement({
        orgName: org.name,
        orgType: org.type,
        ...(parentOrgType ? { parentOrgType } : {}),
        month,
        year,
        gstRate: gstRate.mul(100).toNumber(),
        pgRate: pgRate.mul(100).toNumber(),
        tdsRate: tdsRate.mul(100).toNumber(),
        rows: data,
      });
      const statement = await tx.revenueStatement.create({
        data: {
          organizationId: org.id,
          Month: month,
          Year: year,
          GrossRevenue: total("gross"),
          netRevenue: total("net"),
          companyShare: total("companyShare"),
          distributorShare: total("distributorShare"),
          partnerShare: total("partnerShare"),
          tdsAmount: total("tds"),
          finalPayout: total("finalPayout"),
          pdfPath,
          status: "GENERATED",
        },
      });
      await queueRevenueStatement(tx, targetOrgId, statement.id);
      return statement.id;
    },
    { timeout: 60000 },
  );
  // A saved statement does not imply email delivery. Retry the existing leased job.
  if (statementId && !(await attemptDelivery(revenueDeliveryKey(statementId))))
    throw new Error("Revenue statement email is pending; retry delivery");
  return statementId;
}
