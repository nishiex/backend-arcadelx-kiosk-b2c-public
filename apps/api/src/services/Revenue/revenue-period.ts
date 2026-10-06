export function revenueMonth(month: number, year: number) {
  if (
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 9999
  )
    throw new Error("Invalid statement period");
  // Indian accounting months, with an exclusive end boundary.
  return {
    start: new Date(Date.UTC(year, month - 1, 1) - 330 * 60000),
    end: new Date(Date.UTC(year, month, 1) - 330 * 60000),
  };
}
export function indiaCalendar(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const value = (kind: string) =>
    Number(parts.find((p) => p.type === kind)!.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}
