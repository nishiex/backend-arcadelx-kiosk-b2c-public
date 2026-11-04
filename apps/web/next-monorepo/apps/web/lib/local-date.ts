/**
 * Calendar-date helpers for the scheduler.
 *
 * The dashboard's calendar emits a `Date` at **local** midnight, so the date has to be
 * read back with local getters. Formatting it with `toISOString()` renders the same
 * instant in UTC, which lands on the previous day for every zone east of UTC:
 * in IST, picking 5 Nov produced `2026-11-04`, and picking today produced yesterday,
 * which the API then rejected with "Scheduled date cannot be in the past".
 */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
