const DAY = 24 * 3600 * 1000;

/** Whole calendar days between two moments (local time), so "worn last night" is "yesterday", not "today". */
export function daysBetween(then: number, now: number = Date.now()): number {
  const a = new Date(then);
  const b = new Date(now);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(b) - start(a)) / DAY);
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago". */
export function ago(then: number, now: number = Date.now()): string {
  const d = daysBetween(then, now);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  const y = Math.round(d / 365);
  return `${y} ${y === 1 ? "year" : "years"} ago`;
}
