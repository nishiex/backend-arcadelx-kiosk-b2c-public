import type { Request, Response } from "express";
import { prisma } from "../../utils/db";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { env } from "../../config/env";

type AnalyticsPage = {
  status: string;
  group_by: string;
  total_events: number;
  error_events: number;
  unique_devices: number;
  events: Array<Record<string, unknown>>;
  groups: Array<Record<string, unknown>>;
  limit: number;
  page: number;
  total_pages: number;
};

async function fetchAnalyticsPage(page: number): Promise<AnalyticsPage> {
  const url = new URL(env.MOTHERSHIP_ANALYTICS_SUMMARY_URL);
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", "50");
  url.searchParams.set("group_by", "category");
  const upstream = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!upstream.ok) throw new ApiError(502, `Analytics upstream returned ${upstream.status}`);
  return await upstream.json() as AnalyticsPage;
}

export const getAnalyticsSummary = asyncHandler(async (req: Request, res: Response) => {
  const firstPage = await fetchAnalyticsPage(1);
  if (req.membership!.type === "COMPANY") return res.status(200).json(new ApiResponse(200, firstPage));

  const kiosks = await prisma.kiosk.findMany({
    where: { currentOrgId: req.membership!.organizationId },
    select: { machineCode: true, externalDeviceId: true },
  });
  const visibleDeviceIds = new Set(kiosks.flatMap((kiosk) =>
    [kiosk.machineCode, kiosk.externalDeviceId].filter((value): value is string => Boolean(value)),
  ));
  const pages = [firstPage];
  for (let page = 2; page <= Math.min(firstPage.total_pages || 1, 100); page += 1) {
    pages.push(await fetchAnalyticsPage(page));
  }
  const events = pages.flatMap((page) => page.events)
    .filter((event) => visibleDeviceIds.has(String(event.device_id ?? "")));
  const groupCounts = new Map<string, number>();
  for (const event of events) {
    const key = String(event.category ?? "unknown");
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  }
  const data = {
    status: firstPage.status,
    group_by: "category",
    total_events: events.length,
    error_events: events.filter((event) => String(event.error_code ?? "").toUpperCase() !== "NONE").length,
    unique_devices: new Set(events.map((event) => String(event.device_id ?? ""))).size,
    events,
    groups: [...groupCounts.entries()].map(([key, count]) => ({ key, count })),
    limit: events.length || firstPage.limit,
    page: 1,
    total_pages: 1,
  };
  return res.status(200).json(new ApiResponse(200, data));
});
