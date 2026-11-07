import { DUBAI_TZ, LDN_TZ, NY_TZ } from "./instruments";

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface ZParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  wd: number;
}

export function tzParts(t: number | Date, tz: string): ZParts {
  const parts = fmt(tz).formatToParts(typeof t === "number" ? new Date(t) : t);
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  return {
    y: +o.year,
    m: +o.month,
    d: +o.day,
    h: +o.hour % 24,
    mi: +o.minute,
    s: +o.second,
    wd: WD[o.weekday] ?? 0,
  };
}

function offsetMs(t: number, tz: string) {
  const p = tzParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}

/** Local wall time in a zone -> UTC ms (DST aware). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offsetMs(guess, tz);
  let t = guess - off;
  const off2 = offsetMs(t, tz);
  if (off2 !== off) t = guess - off2;
  return t;
}

/** Calendar date arithmetic on y/m/d. */
export function addDays(y: number, m: number, d: number, n: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

export function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface SessionWindows {
  key: string; // NY trading date
  wd: number;
  asiaStart: number;
  londonOpen: number;
  londonClose: number;
  nyOpen: number;
  nyClose: number;
}

/** Windows for a trading day identified by its New York calendar date. */
export function sessionWindows(y: number, m: number, d: number): SessionWindows {
  const prev = addDays(y, m, d, -1);
  return {
    key: dateKey(y, m, d),
    wd: addDays(y, m, d, 0).wd,
    asiaStart: zonedToUtc(prev.y, prev.m, prev.d, 18, 0, NY_TZ),
    londonOpen: zonedToUtc(y, m, d, 8, 0, LDN_TZ),
    londonClose: zonedToUtc(y, m, d, 16, 30, LDN_TZ),
    nyOpen: zonedToUtc(y, m, d, 8, 0, NY_TZ),
    nyClose: zonedToUtc(y, m, d, 17, 0, NY_TZ),
  };
}

/** Trading day (NY date) a timestamp belongs to: after 18:00 NY rolls to next day. */
export function tradingDayOf(t: number) {
  const p = tzParts(t, NY_TZ);
  if (p.h >= 18) return addDays(p.y, p.m, p.d, 1);
  return { y: p.y, m: p.m, d: p.d, wd: p.wd };
}

export function isMarketOpen(t: number) {
  const p = tzParts(t, NY_TZ);
  if (p.wd === 6) return false;
  if (p.wd === 5 && p.h >= 17) return false;
  if (p.wd === 0 && p.h < 18) return false;
  return true;
}

export type SessionName = "Asia" | "London" | "London/NY overlap" | "New York" | "Daily break" | "Closed";

export function currentSession(t: number): SessionName {
  if (!isMarketOpen(t)) return "Closed";
  const td = tradingDayOf(t);
  const w = sessionWindows(td.y, td.m, td.d);
  const inL = t >= w.londonOpen && t < w.londonClose;
  const inN = t >= w.nyOpen && t < w.nyClose;
  if (inL && inN) return "London/NY overlap";
  if (inL) return "London";
  if (inN) return "New York";
  if (t >= w.asiaStart && t < w.londonOpen) return "Asia";
  if (t >= w.nyClose) return "Daily break";
  return "Asia";
}

const dubaiFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: DUBAI_TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dubaiTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: DUBAI_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function fmtDubai(t: number | string) {
  return dubaiFmt.format(new Date(t));
}
export function fmtDubaiTime(t: number | string) {
  return dubaiTime.format(new Date(t));
}

export function fmtCountdown(ms: number) {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

/** Key session timestamps around `t` (for hot-window detection). */
export function keyTimesAround(t: number): number[] {
  const td = tradingDayOf(t);
  const out: number[] = [];
  for (const off of [-1, 0, 1]) {
    const dd = addDays(td.y, td.m, td.d, off);
    const w = sessionWindows(dd.y, dd.m, dd.d);
    out.push(w.asiaStart, w.londonOpen, w.londonClose, w.nyOpen, w.nyClose);
  }
  return out;
}
