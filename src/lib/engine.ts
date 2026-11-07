// Pure analytics shared by the scheduled job and the dashboard.
import { NY_TZ } from "./instruments";
import {
  addDays,
  dateKey,
  sessionWindows,
  tradingDayOf,
  tzParts,
  zonedToUtc,
  type SessionWindows,
} from "./time";

export interface Candle {
  t: number; // ms UTC (bar start)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const HOUR = 3600_000;

// ---------- indicators ----------
export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export type Trend = "up" | "down" | "sideways" | "n/a";

export function trendOf(candles: Candle[]): Trend {
  if (candles.length < 55) return "n/a";
  const closes = candles.map((c) => c.c);
  const e20 = ema(closes, 20).at(-1)!;
  const e50 = ema(closes, 50).at(-1)!;
  const last = closes.at(-1)!;
  const rec = candles.slice(-10);
  const prv = candles.slice(-20, -10);
  const hh = Math.max(...rec.map((c) => c.h)) > Math.max(...prv.map((c) => c.h));
  const hl = Math.min(...rec.map((c) => c.l)) > Math.min(...prv.map((c) => c.l));
  const lh = Math.max(...rec.map((c) => c.h)) < Math.max(...prv.map((c) => c.h));
  const ll = Math.min(...rec.map((c) => c.l)) < Math.min(...prv.map((c) => c.l));
  if (e20 > e50 && last > e20 && (hh || hl)) return "up";
  if (e20 < e50 && last < e20 && (lh || ll)) return "down";
  return "sideways";
}

export function aggregate(candles: Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const b = Math.floor(c.t / ms) * ms;
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur);
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      cur.h = Math.max(cur.h, c.h);
      cur.l = Math.min(cur.l, c.l);
      cur.c = c.c;
      cur.v += c.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- candle lookup helpers ----------
function lowerBound(c: Candle[], t: number) {
  let lo = 0,
    hi = c.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function inRange(c: Candle[], a: number, b: number) {
  return c.slice(lowerBound(c, a), lowerBound(c, b));
}
function openAt(c: Candle[], t: number, tol = HOUR) {
  const i = lowerBound(c, t);
  return i < c.length && c[i].t < t + tol ? c[i].o : null;
}
function closeBefore(c: Candle[], t: number, bar = HOUR) {
  const k = lowerBound(c, t - bar + 1) - 1; // last bar fully closed by t
  return k >= 0 && c[k].t >= t - 3 * HOUR ? c[k].c : null;
}
function hiLo(c: Candle[]) {
  if (!c.length) return null;
  return { hi: Math.max(...c.map((x) => x.h)), lo: Math.min(...c.map((x) => x.l)) };
}
const pct = (a: number, b: number) => ((b - a) / a) * 100;

// ---------- session levels for the live day ----------
export interface DayLevels {
  windows: SessionWindows;
  dailyOpen: number | null;
  asia: { hi: number; lo: number } | null;
  london: { hi: number; lo: number } | null;
  ny: { hi: number; lo: number } | null;
  prevDay: { hi: number; lo: number } | null;
}

export function dayLevels(c1h: Candle[], c15: Candle[], now: number): DayLevels {
  const td = tradingDayOf(now);
  const w = sessionWindows(td.y, td.m, td.d);
  let pd = addDays(td.y, td.m, td.d, -1);
  while (pd.wd === 0 || pd.wd === 6) pd = addDays(pd.y, pd.m, pd.d, -1);
  const pw = sessionWindows(pd.y, pd.m, pd.d);
  const src = c15.length ? c15 : c1h;
  const day = inRange(src, w.asiaStart, w.nyClose);
  return {
    windows: w,
    dailyOpen: day[0]?.o ?? null,
    asia: hiLo(inRange(src, w.asiaStart, Math.min(w.londonOpen, now))),
    london: now > w.londonOpen ? hiLo(inRange(src, w.londonOpen, Math.min(w.londonClose, now))) : null,
    ny: now > w.nyOpen ? hiLo(inRange(src, w.nyOpen, Math.min(w.nyClose, now))) : null,
    prevDay: hiLo(inRange(c1h, pw.asiaStart, pw.nyClose)),
  };
}

export interface StructureFlag {
  level: string;
  side: "high" | "low";
  kind: "sweep" | "bos";
  price: number;
  text: string;
  at: number;
}

/** Liquidity sweeps (wick through, close back inside) & breaks of structure (close beyond, holding). */
export function structureFlags(c15: Candle[], lv: DayLevels, now: number): StructureFlag[] {
  const flags: StructureFlag[] = [];
  const w = lv.windows;
  const levels: { name: string; hi: number; lo: number; from: number }[] = [];
  if (lv.prevDay) levels.push({ name: "Prev day", ...lv.prevDay, from: w.asiaStart });
  if (lv.asia && now > w.londonOpen) levels.push({ name: "Asia", ...lv.asia, from: w.londonOpen });
  if (lv.london && now > w.londonClose) levels.push({ name: "London", ...lv.london, from: w.londonClose });
  for (const L of levels) {
    const after = inRange(c15, L.from, now + 1);
    if (after.length < 1) continue;
    const last = after.at(-1)!;
    const last2 = after.slice(-2);
    for (const side of ["high", "low"] as const) {
      const lvl = side === "high" ? L.hi : L.lo;
      const pierced = after.some((c) => (side === "high" ? c.h > lvl : c.l < lvl));
      if (!pierced) continue;
      const holding =
        last2.length === 2 && last2.every((c) => (side === "high" ? c.c > lvl : c.c < lvl));
      const back = side === "high" ? last.c < lvl : last.c > lvl;
      const at = after.find((c) => (side === "high" ? c.h > lvl : c.l < lvl))!.t;
      if (holding)
        flags.push({
          level: L.name,
          side,
          kind: "bos",
          price: lvl,
          at,
          text: `Broke ${L.name} ${side} & holding (BOS ${side === "high" ? "↑" : "↓"})`,
        });
      else if (back)
        flags.push({
          level: L.name,
          side,
          kind: "sweep",
          price: lvl,
          at,
          text: `Swept ${L.name} ${side}, closed back inside (possible ${side === "high" ? "↓" : "↑"} reversal)`,
        });
    }
  }
  return flags;
}

// ---------- session pattern engine ----------
export interface DayRec {
  d: string;
  wd: number;
  L: number; // London open -> NY open %
  N: number; // NY open -> NY close %
  c: boolean | null; // NY continued London
  ar: number;
  lr: number;
  nr: number;
  sw: boolean; // London swept Asia high/low
}

export interface Rate {
  rate: number | null;
  n: number;
}

export interface PatternStats {
  days: DayRec[];
  avgAbsL: number;
  avgAbsN: number;
  medianRatio: number | null;
  avgRange: { asia: number; london: number; ny: number };
  hit: {
    all: Rate;
    last20: Rate;
    last60: Rate;
    byWeekday: Record<string, Rate>;
    londonBig: Rate;
    londonSmall: Rate;
    sweptAsia: Rate;
    noSweep: Rate;
    bigAndSwept: Rate;
  };
  vol: {
    avgHour: number;
    firstHour: { asia: number; london: number; ny: number };
    lastHour: { london: number; ny: number };
    weeklyGap: { avgAbs: number; avgSigned: number; n: number };
    byDubaiHour: number[];
  };
  from: number | null;
  to: number | null;
}

export function rate(days: DayRec[]): Rate {
  const v = days.filter((d) => d.c !== null);
  if (!v.length) return { rate: null, n: 0 };
  return { rate: (v.filter((d) => d.c).length / v.length) * 100, n: v.length };
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function computePatternStats(c: Candle[]): PatternStats {
  const days: DayRec[] = [];
  const firstA: number[] = [],
    firstL: number[] = [],
    firstN: number[] = [],
    lastL: number[] = [],
    lastN: number[] = [],
    gaps: number[] = [];
  if (c.length) {
    const startDay = tradingDayOf(c[0].t);
    const endDay = tradingDayOf(c.at(-1)!.t);
    let cur = startDay;
    const endKey = dateKey(endDay.y, endDay.m, endDay.d);
    for (let guard = 0; guard < 1200; guard++) {
      const k = dateKey(cur.y, cur.m, cur.d);
      if (cur.wd >= 1 && cur.wd <= 5) {
        const w = sessionWindows(cur.y, cur.m, cur.d);
        const lo = openAt(c, w.londonOpen);
        const no = openAt(c, w.nyOpen);
        const nc = closeBefore(c, w.nyClose);
        const a = hiLo(inRange(c, w.asiaStart, w.londonOpen));
        const l = hiLo(inRange(c, w.londonOpen, w.londonClose));
        const n = hiLo(inRange(c, w.nyOpen, w.nyClose));
        if (lo && no && nc && a && l && n) {
          const L = pct(lo, no);
          const N = pct(no, nc);
          days.push({
            d: k,
            wd: cur.wd,
            L,
            N,
            c: L === 0 || N === 0 ? null : Math.sign(L) === Math.sign(N),
            ar: ((a.hi - a.lo) / lo) * 100,
            lr: ((l.hi - l.lo) / lo) * 100,
            nr: ((n.hi - n.lo) / no) * 100,
            sw: l.hi > a.hi || l.lo < a.lo,
          });
        }
        const fh = (t: number) => {
          const i = lowerBound(c, t);
          return i < c.length && c[i].t < t + HOUR ? Math.abs(pct(c[i].o, c[i].c)) : null;
        };
        const lh = (t: number) => {
          const i = lowerBound(c, t) - 1;
          return i >= 0 && c[i].t >= t - 2 * HOUR ? Math.abs(pct(c[i].o, c[i].c)) : null;
        };
        const push = (arr: number[], v: number | null) => v !== null && arr.push(v);
        push(firstA, fh(w.asiaStart));
        push(firstL, fh(w.londonOpen));
        push(firstN, fh(w.nyOpen));
        push(lastL, lh(w.londonClose));
        push(lastN, lh(w.nyClose));
        if (cur.wd === 1) {
          const i = lowerBound(c, w.asiaStart);
          if (i > 0 && i < c.length && c[i].t < w.asiaStart + 2 * HOUR && c[i].t - c[i - 1].t > 24 * HOUR)
            gaps.push(pct(c[i - 1].c, c[i].o));
        }
      }
      if (k === endKey) break;
      cur = addDays(cur.y, cur.m, cur.d, 1);
    }
  }
  const avgAbsL = mean(days.map((d) => Math.abs(d.L)));
  const avgAbsN = mean(days.map((d) => Math.abs(d.N)));
  const ratios = days
    .filter((d) => Math.abs(d.L) > 0.01)
    .map((d) => Math.abs(d.N) / Math.abs(d.L))
    .sort((a, b) => a - b);
  const byWeekday: Record<string, Rate> = {};
  for (const [i, n] of ["Mon", "Tue", "Wed", "Thu", "Fri"].entries())
    byWeekday[n] = rate(days.filter((d) => d.wd === i + 1));
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  for (const x of c) byHour[tzParts(x.t, "Asia/Dubai").h].push(Math.abs(pct(x.o, x.c)));
  return {
    days,
    avgAbsL,
    avgAbsN,
    medianRatio: ratios.length ? ratios[Math.floor(ratios.length / 2)] : null,
    avgRange: {
      asia: mean(days.map((d) => d.ar)),
      london: mean(days.map((d) => d.lr)),
      ny: mean(days.map((d) => d.nr)),
    },
    hit: {
      all: rate(days),
      last20: rate(days.slice(-20)),
      last60: rate(days.slice(-60)),
      byWeekday,
      londonBig: rate(days.filter((d) => Math.abs(d.L) > avgAbsL)),
      londonSmall: rate(days.filter((d) => Math.abs(d.L) <= avgAbsL)),
      sweptAsia: rate(days.filter((d) => d.sw)),
      noSweep: rate(days.filter((d) => !d.sw)),
      bigAndSwept: rate(days.filter((d) => d.sw && Math.abs(d.L) > avgAbsL)),
    },
    vol: {
      avgHour: mean(c.map((x) => Math.abs(pct(x.o, x.c)))),
      firstHour: { asia: mean(firstA), london: mean(firstL), ny: mean(firstN) },
      lastHour: { london: mean(lastL), ny: mean(lastN) },
      weeklyGap: { avgAbs: mean(gaps.map(Math.abs)), avgSigned: mean(gaps), n: gaps.length },
      byDubaiHour: byHour.map(mean),
    },
    from: c[0]?.t ?? null,
    to: c.at(-1)?.t ?? null,
  };
}

export interface HeadsUp {
  dir: "up" | "down";
  londonMove: number;
  clear: boolean;
  rate: number | null;
  n: number;
  basis: string;
  text: string;
}

/** Live: London's direction so far into the NY open + historical conditional hit rate. */
export function sessionHeadsUp(
  c: Candle[],
  stats: PatternStats | null,
  lv: DayLevels,
  now: number,
): HeadsUp | null {
  const w = lv.windows;
  if (!stats || now < w.londonOpen) return null;
  const lo = openAt(c, w.londonOpen, 30 * 60_000) ?? openAt(c, w.londonOpen);
  const ref = now >= w.nyOpen ? (openAt(c, w.nyOpen, 30 * 60_000) ?? c.at(-1)?.c) : c.at(-1)?.c;
  if (!lo || !ref) return null;
  const L = pct(lo, ref);
  const big = Math.abs(L) > stats.avgAbsL;
  const clear = Math.abs(L) >= 0.5 * stats.avgAbsL;
  const swept = !!(lv.asia && lv.london && (lv.london.hi > lv.asia.hi || lv.london.lo < lv.asia.lo));
  let pick: Rate = stats.hit.all;
  let basis = "all days";
  if (big && swept && stats.hit.bigAndSwept.n >= 15) {
    pick = stats.hit.bigAndSwept;
    basis = "big London move after Asia sweep";
  } else if (big && stats.hit.londonBig.n >= 15) {
    pick = stats.hit.londonBig;
    basis = "London moved > 1× avg";
  } else if (swept && stats.hit.sweptAsia.n >= 15) {
    pick = stats.hit.sweptAsia;
    basis = "London swept Asia";
  }
  const dir = L >= 0 ? "up" : "down";
  return {
    dir,
    londonMove: L,
    clear,
    rate: pick.rate,
    n: pick.n,
    basis,
    text: clear
      ? `London ${dir === "up" ? "↑" : "↓"} ${L >= 0 ? "+" : ""}${L.toFixed(2)}% · NY continued London ${pick.rate?.toFixed(0) ?? "–"}% of the time (n=${pick.n}, ${basis})`
      : `London has no clear direction yet (${L >= 0 ? "+" : ""}${L.toFixed(2)}%)`,
  };
}

// ---------- events ----------
export interface EventRow {
  id: string;
  name: string;
  rule: string;
  weekday: number | null;
  local_time: string;
  tz: string;
  instruments: string[];
  impact: number;
  context_only: boolean;
  higher_is_bullish: boolean;
  enabled: boolean;
}
export interface EventDateRow {
  id: string;
  event_id: string;
  ts: string;
  consensus: number | null;
  previous: number | null;
  actual: number | null;
  notes: string | null;
}

/** Occurrences (ms UTC) between a and b, generated from the rule plus manual dates. */
export function occurrences(ev: EventRow, dates: EventDateRow[], a: number, b: number): number[] {
  const [hh, mm] = ev.local_time.split(":").map(Number);
  const set = new Set<number>();
  for (const d of dates) if (d.event_id === ev.id) set.add(new Date(d.ts).getTime());
  if (ev.rule === "weekly" || ev.rule === "first_friday") {
    const s = tzParts(a, ev.tz);
    let cur = addDays(s.y, s.m, s.d, -1);
    const maxDays = Math.ceil((b - a) / 86400000) + 3;
    for (let i = 0; i < maxDays; i++) {
      const ok =
        ev.rule === "weekly" ? cur.wd === ev.weekday : cur.wd === 5 && cur.d <= 7;
      if (ok) set.add(zonedToUtc(cur.y, cur.m, cur.d, hh, mm, ev.tz));
      cur = addDays(cur.y, cur.m, cur.d, 1);
    }
  }
  return [...set].filter((t) => t >= a && t <= b).sort((x, y) => x - y);
}

export interface ReactionGroup {
  n: number;
  avg1h: number;
  avgAbs1h: number;
  up1h: number;
  avg3h: number;
  avgAbs3h: number;
  up3h: number;
}
export interface Reaction {
  all: ReactionGroup;
  above: ReactionGroup | null; // actual > consensus
  below: ReactionGroup | null;
}

function group(moves: { m1: number; m3: number }[]): ReactionGroup {
  return {
    n: moves.length,
    avg1h: mean(moves.map((x) => x.m1)),
    avgAbs1h: mean(moves.map((x) => Math.abs(x.m1))),
    up1h: moves.length ? (moves.filter((x) => x.m1 > 0).length / moves.length) * 100 : 0,
    avg3h: mean(moves.map((x) => x.m3)),
    avgAbs3h: mean(moves.map((x) => Math.abs(x.m3))),
    up3h: moves.length ? (moves.filter((x) => x.m3 > 0).length / moves.length) * 100 : 0,
  };
}

/**
 * Historical reaction from 1h candles. Base = open of the hour containing the release;
 * "1h" = close of that hour, "3h" = close two hours later (approximation on hourly bars).
 */
export function eventReaction(
  ev: EventRow,
  dates: EventDateRow[],
  c: Candle[],
  now: number,
): Reaction | null {
  if (!c.length) return null;
  const occ = occurrences(ev, dates, c[0].t, now - 3 * HOUR).slice(-50);
  const moves: { t: number; m1: number; m3: number }[] = [];
  for (const t of occ) {
    const i = lowerBound(c, Math.floor(t / HOUR) * HOUR);
    if (i >= c.length || c[i].t > t) continue;
    const base = c[i].o;
    const c3 = c.slice(i, i + 3).at(-1);
    if (!c3 || c3.t > t + 3 * HOUR) continue;
    moves.push({ t, m1: pct(base, c[i].c), m3: pct(base, c3.c) });
  }
  if (!moves.length) return null;
  const byT = new Map(
    dates.filter((d) => d.event_id === ev.id).map((d) => [new Date(d.ts).getTime(), d]),
  );
  const above = moves.filter((m) => {
    const d = byT.get(m.t);
    return d && d.actual != null && d.consensus != null && d.actual > d.consensus;
  });
  const below = moves.filter((m) => {
    const d = byT.get(m.t);
    return d && d.actual != null && d.consensus != null && d.actual < d.consensus;
  });
  return {
    all: group(moves),
    above: above.length ? group(above) : null,
    below: below.length ? group(below) : null,
  };
}

export function reactionText(name: string, inst: string, r: Reaction | null) {
  if (!r || r.all.n < 3) return `Not enough history yet for ${inst} after ${name}.`;
  const g = r.all;
  const dir1 = g.up1h >= 60 ? "tends to rise" : g.up1h <= 40 ? "tends to fall" : "has no consistent direction";
  return `${inst} ${dir1} in the hour after ${name} (up ${g.up1h.toFixed(0)}% of ${g.n} times). Typical move ±${g.avgAbs1h.toFixed(2)}% in 1h, ±${g.avgAbs3h.toFixed(2)}% in 3h.`;
}

// ---------- news sentiment ----------
export interface NewsRow {
  id: string;
  title: string;
  url: string;
  source: string | null;
  published_at: string;
  instruments: string[];
  sentiment: Record<string, string>;
  impact: number;
  reason: string | null;
  tagged: boolean;
}

export interface Sentiment {
  bullPct: number | null;
  score: number; // -1..1
  n: number;
}

export function sentimentFor(news: NewsRow[], inst: string, since: number): Sentiment {
  let bull = 0,
    bear = 0,
    neu = 0,
    n = 0;
  for (const x of news) {
    if (!x.tagged || new Date(x.published_at).getTime() < since) continue;
    const s = x.sentiment?.[inst];
    if (!s) continue;
    n++;
    const w = x.impact || 1;
    if (s === "bullish") bull += w;
    else if (s === "bearish") bear += w;
    else neu += w;
  }
  const tot = bull + bear + neu;
  return {
    bullPct: bull + bear > 0 ? (bull / (bull + bear)) * 100 : null,
    score: tot ? (bull - bear) / tot : 0,
    n,
  };
}

// ---------- bias ----------
export interface BiasComponent {
  name: string;
  value: number; // -1..1
  weight: number;
  note: string;
}
export interface Bias {
  label: "Bullish" | "Bearish" | "Neutral";
  confidence: number;
  score: number;
  components: BiasComponent[];
}

const tv = (t: Trend) => (t === "up" ? 1 : t === "down" ? -1 : 0);

export function computeBias(input: {
  trends: Record<string, Trend>;
  headsUp: HeadsUp | null;
  sent24: Sentiment;
  nearEvent: { name: string; inMin: number; reaction: Reaction | null } | null;
}): Bias {
  const t = input.trends;
  const trendV = tv(t["15m"]) * 0.1 + tv(t["1h"]) * 0.2 + tv(t["4h"]) * 0.3 + tv(t["1d"]) * 0.4;
  const comps: BiasComponent[] = [
    {
      name: "Multi-timeframe trend",
      value: trendV,
      weight: 35,
      note: `15m ${t["15m"]} · 1h ${t["1h"]} · 4h ${t["4h"]} · D ${t["1d"]}`,
    },
  ];
  const h = input.headsUp;
  if (h && h.clear && h.rate !== null) {
    const edge = (h.rate - 50) / 50; // + => continuation likely
    comps.push({
      name: "Session pattern",
      value: (h.dir === "up" ? 1 : -1) * edge,
      weight: 25,
      note: `London ${h.dir === "up" ? "↑" : "↓"} ${h.londonMove.toFixed(2)}%, continuation ${h.rate.toFixed(0)}% (n=${h.n})`,
    });
  } else {
    comps.push({ name: "Session pattern", value: 0, weight: 25, note: h ? h.text : "London not open yet" });
  }
  comps.push({
    name: "News sentiment (24h)",
    value: input.sent24.score,
    weight: 25,
    note:
      input.sent24.n > 0
        ? `${input.sent24.bullPct?.toFixed(0) ?? "–"}% bullish of ${input.sent24.n} tagged headlines`
        : "No tagged headlines",
  });
  const ev = input.nearEvent;
  if (ev) {
    const r = ev.reaction?.all;
    const v = r && r.n >= 5 ? (r.up1h - 50) / 50 : 0;
    comps.push({
      name: "Upcoming event",
      value: v,
      weight: 15,
      note: `${ev.name} in ${ev.inMin}m${r ? ` · up after ${r.up1h.toFixed(0)}% (n=${r.n})` : ""} — expect volatility`,
    });
  } else comps.push({ name: "Upcoming event", value: 0, weight: 15, note: "No high-impact event in next 6h" });
  const wsum = comps.reduce((s, c) => s + c.weight, 0);
  const score = comps.reduce((s, c) => s + c.value * c.weight, 0) / wsum;
  let confidence = Math.round(50 + 50 * Math.min(1, Math.abs(score) * 1.6));
  if (ev && ev.inMin <= 90) confidence = Math.max(0, confidence - 10);
  const label = score > 0.12 ? "Bullish" : score < -0.12 ? "Bearish" : "Neutral";
  if (label === "Neutral") confidence = Math.round(100 - Math.abs(score) * 300);
  return { label, confidence: Math.max(0, Math.min(100, confidence)), score, components: comps };
}

export { NY_TZ };
