import type { RevenueSeriesRange } from "@shared-types/validationSchemas/Revenue/revenue.validation";

/**
 * IST bucketing for the dashboard revenue trend.
 *
 * Mirrors the timezone convention already used by `getMachineWiseRevenue`: its
 * "today"/"this month" boundaries are computed with the same `330 * 60000`
 * (UTC+5:30) offset, so the trend agrees with that endpoint instead of
 * introducing a second timezone rule. Buckets are IST calendar days, ISO weeks
 * (Monday start, as PostgreSQL's `date_trunc('week', ...)`) and calendar months.
 */

/** Minutes added to a UTC instant to obtain IST wall-clock time. */
export const IST_OFFSET_MINUTES = 330;

export type RevenueBucket = "day" | "week" | "month";

export const RANGE_CONFIG: Record<RevenueSeriesRange, { days: number; bucket: RevenueBucket; granularity: string }> = {
  "7d": { days: 7, bucket: "day", granularity: "Daily" },
  "30d": { days: 30, bucket: "day", granularity: "Daily" },
  "3m": { days: 90, bucket: "week", granularity: "Weekly" },
  "1y": { days: 365, bucket: "month", granularity: "Monthly" },
};

/** IST wall-clock parts for one instant. */
function istParts(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** IST calendar day containing `date`, encoded as UTC midnight of that day. */
export function istDayStart(date: Date) {
  const { year, month, day } = istParts(date);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Monday of the IST calendar week containing `date`. */
export function istWeekStart(date: Date) {
  const dayStart = istDayStart(date);
  // getUTCDay: 0 = Sunday, so shift to a Monday-first week.
  const weekday = istParts(date).weekday;
  return new Date(dayStart.getTime() - (weekday === 0 ? 6 : weekday - 1) * 86400000);
}

/** Bucket start (UTC-midnight encoded) for a calendar day already in IST terms. */
export function bucketStart(date: Date, bucket: RevenueBucket) {
  if (bucket === "day") return istDayStart(date);
  if (bucket === "week") return istWeekStart(date);
  const { year, month } = istParts(date);
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Stable bucket key, matching the `YYYY-MM-DD` values the aggregation returns. */
export function bucketKey(date: Date, bucket: RevenueBucket) {
  return bucketStart(date, bucket).toISOString().slice(0, 10);
}

const dayLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const monthLabel = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Axis label for a bucket start (already encoded as UTC midnight). */
export function bucketLabel(bucketDate: Date, bucket: RevenueBucket) {
  return bucket === "month" ? monthLabel.format(bucketDate) : dayLabel.format(bucketDate);
}

/**
 * Every bucket start covering the range, in chronological order. Listed
 * explicitly so buckets without revenue are charted as zero instead of the
 * timeline silently collapsing.
 */
export function rangeBuckets(range: RevenueSeriesRange, now = new Date()) {
  const { days, bucket } = RANGE_CONFIG[range];
  const firstDay = istDayStart(new Date(now.getTime() - (days - 1) * 86400000));
  const lastDay = istDayStart(now);
  const buckets: Date[] = [];
  for (let cursor = firstDay; cursor.getTime() <= lastDay.getTime(); cursor = new Date(cursor.getTime() + 86400000)) {
    const start = bucketStart(cursor, bucket);
    if (buckets.length && buckets[buckets.length - 1]!.getTime() === start.getTime()) continue;
    buckets.push(start);
  }
  return buckets;
}

/** Inclusive lower bound for the range, as the instant IST midnight began. */
export function rangeFilterStart(range: RevenueSeriesRange, now = new Date()) {
  return new Date(rangeBuckets(range, now)[0]!.getTime() - IST_OFFSET_MINUTES * 60000);
}

/** The SQL bucket unit for a range; PostgreSQL's weeks also start on Monday. */
export function sqlBucket(range: RevenueSeriesRange) {
  return RANGE_CONFIG[range].bucket;
}
