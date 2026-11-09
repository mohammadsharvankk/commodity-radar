// Loads data through any Supabase client (user-scoped or admin) and builds the
// per-instrument snapshot used by the dashboard, detail page and alerts.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  aggregate,
  computeBias,
  dayLevels,
  eventReaction,
  occurrences,
  sentimentFor,
  sessionHeadsUp,
  structureFlags,
  trendOf,
  type Bias,
  type Candle,
  type DayLevels,
  type EventDateRow,
  type EventRow,
  type HeadsUp,
  type NewsRow,
  type PatternStats,
  type Reaction,
  type Sentiment,
  type StructureFlag,
  type Trend,
} from "./engine";
import { INSTRUMENTS, type InstrumentId } from "./instruments";
import { currentSession, type SessionName } from "./time";

type DB = SupabaseClient<Database>;

export async function loadCandles(
  db: DB,
  inst: string,
  tf: string,
  sinceMs: number,
): Promise<Candle[]> {
  const out: Candle[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("candles")
      .select("ts,open,high,low,close,volume")
      .eq("instrument", inst)
      .eq("timeframe", tf)
      .gte("ts", new Date(sinceMs).toISOString())
      .order("ts", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? [])
      out.push({
        t: new Date(r.ts).getTime(),
        o: r.open,
        h: r.high,
        l: r.low,
        c: r.close,
        v: r.volume,
      });
    if (!data || data.length < page) break;
  }
  return out;
}

export async function loadEvents(db: DB) {
  const [{ data: ev, error: e1 }, { data: dates, error: e2 }] = await Promise.all([
    db.from("events").select("*").order("created_at"),
    db.from("event_dates").select("*").order("ts"),
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);
  return { events: (ev ?? []) as EventRow[], dates: (dates ?? []) as EventDateRow[] };
}

export async function loadNews(db: DB, sinceMs: number, limit = 500) {
  const { data, error } = await db
    .from("news")
    .select("id,title,url,source,published_at,instruments,sentiment,impact,reason,tagged")
    .gte("published_at", new Date(sinceMs).toISOString())
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as NewsRow[];
}

export async function loadStats(db: DB) {
  const { data, error } = await db.from("pattern_stats").select("instrument,data,computed_at");
  if (error) throw new Error(error.message);
  const m: Record<string, { stats: PatternStats; computed_at: string }> = {};
  for (const r of data ?? [])
    m[r.instrument] = { stats: r.data as unknown as PatternStats, computed_at: r.computed_at };
  return m;
}

export interface UpcomingEvent {
  event: EventRow;
  ts: number;
  date: EventDateRow | null;
  reactions: Record<string, Reaction | null>;
}

export interface InstrumentSnapshot {
  id: InstrumentId;
  last: number | null;
  lastTs: number | null;
  changePct: number | null;
  spark: number[];
  trends: Record<string, Trend>;
  session: SessionName;
  levels: DayLevels;
  flags: StructureFlag[];
  headsUp: HeadsUp | null;
  sent6: Sentiment;
  sent24: Sentiment;
  bias: Bias;
  avgHourRange: number | null;
  last15: Candle | null;
}

export interface Snapshot {
  now: number;
  instruments: InstrumentSnapshot[];
  upcoming: UpcomingEvent[];
  lastPoll: string | null;
  backfillDone: boolean;
}

export async function buildSnapshot(db: DB, now = Date.now()): Promise<Snapshot> {
  const d = 86400_000;
  const [statsMap, { events, dates }, news, jobRes] = await Promise.all([
    loadStats(db),
    loadEvents(db),
    loadNews(db, now - d),
    db
      .from("job_state")
      .select("key,value")
      .in("key", ["poll", ...INSTRUMENTS.map((i) => `reactions:${i.id}`)]),
  ]);
  const jobRows = jobRes.data ?? [];
  const poll = (jobRows.find((r) => r.key === "poll")?.value ?? {}) as {
    lastPrice?: number;
    backfill?: Record<string, boolean>;
  };
  const cachedReactions: Record<string, Record<string, Reaction | null>> = {};
  for (const r of jobRows)
    if (r.key.startsWith("reactions:"))
      cachedReactions[r.key.slice(10)] = (r.value ?? {}) as Record<string, Reaction | null>;

  const perInst = await Promise.all(
    INSTRUMENTS.map(async (inst) => {
      const [c15, c1h, c1d] = await Promise.all([
        loadCandles(db, inst.id, "15m", now - 6 * d),
        loadCandles(db, inst.id, "1h", now - 45 * d),
        loadCandles(db, inst.id, "1d", now - 200 * d),
      ]);
      return { inst, c15, c1h, c1d };
    }),
  );

  // Upcoming events (next 7 days) + historical reactions per affected instrument.
  const upcoming: UpcomingEvent[] = [];
  const longH: Record<string, Candle[]> = {};
  const enabled = events.filter((e) => e.enabled);
  const occ = enabled.flatMap((e) =>
    occurrences(e, dates, now - 70 * 60_000, now + 7 * d).map((ts) => ({ e, ts })),
  );
  occ.sort((a, b) => a.ts - b.ts);
  const soon = occ.slice(0, 12);
  if (soon.length) {
    // Prefer reactions cached by the daily stats job; only load long history if no cache yet.
    const need = new Set(soon.flatMap((o) => o.e.instruments).filter((id) => !cachedReactions[id]));
    await Promise.all(
      [...need].map(async (id) => {
        longH[id] = await loadCandles(db, id, "1h", now - 400 * d);
      }),
    );
  }
  for (const { e, ts } of soon) {
    const reactions: Record<string, Reaction | null> = {};
    for (const id of e.instruments)
      reactions[id] =
        cachedReactions[id] && e.id in cachedReactions[id]
          ? cachedReactions[id][e.id]
          : eventReaction(e, dates, longH[id] ?? [], now);
    const date = dates.find((x) => x.event_id === e.id && new Date(x.ts).getTime() === ts) ?? null;
    upcoming.push({ event: e, ts, date, reactions });
  }

  const instruments = perInst.map(({ inst, c15, c1h, c1d }) => {
    const levels = dayLevels(c1h, c15, now);
    const lastC = c15.at(-1) ?? c1h.at(-1) ?? null;
    const last = lastC?.c ?? null;
    const trends: Record<string, Trend> = {
      "15m": trendOf(c15),
      "1h": trendOf(c1h),
      "4h": trendOf(aggregate(c1h, 4 * 3600_000)),
      "1d": trendOf(c1d),
    };
    const stats = statsMap[inst.id]?.stats ?? null;
    const headsUp = sessionHeadsUp(c15.length ? c15 : c1h, stats, levels, now);
    const sent6 = sentimentFor(news, inst.id, now - 6 * 3600_000);
    const sent24 = sentimentFor(news, inst.id, now - d);
    const next = upcoming.find(
      (u) =>
        u.ts > now &&
        u.ts - now < 6 * 3600_000 &&
        u.event.impact >= 4 &&
        u.event.instruments.includes(inst.id),
    );
    const bias = computeBias({
      trends,
      headsUp,
      sent24,
      nearEvent: next
        ? {
            name: next.event.name,
            inMin: Math.round((next.ts - now) / 60000),
            reaction: next.reactions[inst.id],
          }
        : null,
    });
    const recentH = c1h.slice(-24 * 20);
    const avgHourRange = recentH.length
      ? recentH.reduce((s, c) => s + (c.h - c.l), 0) / recentH.length
      : null;
    return {
      id: inst.id,
      last,
      lastTs: lastC?.t ?? null,
      changePct:
        last && levels.dailyOpen ? ((last - levels.dailyOpen) / levels.dailyOpen) * 100 : null,
      spark: (c15.length ? c15 : c1h).slice(-64).map((c) => c.c),
      trends,
      session: currentSession(now),
      levels,
      flags: structureFlags(c15, levels, now),
      headsUp,
      sent6,
      sent24,
      bias,
      avgHourRange,
      last15: c15.at(-1) ?? null,
    } satisfies InstrumentSnapshot;
  });

  return {
    now,
    instruments,
    upcoming,
    lastPoll: poll.lastPrice ? new Date(poll.lastPrice).toISOString() : null,
    backfillDone: !!(poll.backfill && INSTRUMENTS.every((i) => poll.backfill?.[i.id])),
  };
}
