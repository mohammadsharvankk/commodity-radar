// Server-only: data ingestion (Yahoo, RSS), AI tagging, pattern recompute, alerts.
import { createOpenAI } from "@ai-sdk/openai";
import { Output, streamText } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildSnapshot, loadCandles, loadStats } from "./analysis";
import {
  computePatternStats,
  eventReaction,
  reactionText,
  type Candle,
  type EventDateRow,
  type EventRow,
  type Reaction,
} from "./engine";
import { INSTRUMENTS, NY_TZ, getInstrument, type AlertTypeId } from "./instruments";
import {
  currentSession,
  fmtDubaiTime,
  isMarketOpen,
  keyTimesAround,
  sessionWindows,
  tradingDayOf,
  tzParts,
} from "./time";

type DB = SupabaseClient<Database>;
const MIN = 60_000;

// ---------------- Yahoo Finance (free, no key) ----------------
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function yahoo(symbol: string, interval: string, range: string) {
  let lastErr = "";
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=true`,
        { headers: { "User-Agent": UA, Accept: "application/json" } },
      );
      if (!r.ok) {
        lastErr = `${host} ${r.status}`;
        continue;
      }
      const j = (await r.json()) as any;
      const res = j?.chart?.result?.[0];
      const ts: number[] = res?.timestamp ?? [];
      const q = res?.indicators?.quote?.[0] ?? {};
      const rows = [];
      for (let i = 0; i < ts.length; i++) {
        const o = q.open?.[i],
          h = q.high?.[i],
          l = q.low?.[i],
          c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        rows.push({ t: ts[i] * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
      }
      return rows;
    } catch (e) {
      lastErr = `${host} ${(e as Error).message}`;
    }
  }
  throw new Error(`Yahoo ${symbol} ${interval}: ${lastErr}`);
}

async function upsertCandles(
  db: DB,
  inst: string,
  tf: string,
  rows: Awaited<ReturnType<typeof yahoo>>,
) {
  const mapped = rows.map((r) => ({
    instrument: inst,
    timeframe: tf,
    ts: new Date(r.t).toISOString(),
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
  }));
  // dedupe within batch
  const uniq = [...new Map(mapped.map((m) => [m.ts, m])).values()];
  for (let i = 0; i < uniq.length; i += 1000) {
    const { error } = await db
      .from("candles")
      .upsert(uniq.slice(i, i + 1000), { onConflict: "instrument,timeframe,ts" });
    if (error) throw new Error(`upsert ${inst} ${tf}: ${error.message}`);
  }
  return uniq.length;
}

// ---------------- job state ----------------
async function getState<T = any>(db: DB, key: string): Promise<T> {
  const { data } = await db.from("job_state").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? {}) as T;
}
async function setState(db: DB, key: string, value: unknown) {
  const { error } = await db
    .from("job_state")
    .upsert({ key, value: value as any, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

interface PollState {
  lastDaily?: number;
  statsDone?: Record<string, string>;
  lastRun?: { phase: string; at: string; ms: number; ok: boolean; info?: string };
  lastPrice?: number;
  lastNews?: number;
  statsDay?: string;
  backfill?: Record<string, boolean>;
  lastError?: string;
  lastPhase?: string;
}

export async function backfillInstrument(db: DB, id: string) {
  const inst = getInstrument(id)!;
  const [h, m15, d1] = await Promise.all([
    yahoo(inst.symbol, "60m", "730d"),
    yahoo(inst.symbol, "15m", "60d"),
    yahoo(inst.symbol, "1d", "2y"),
  ]);
  await upsertCandles(db, id, "1h", h);
  await upsertCandles(db, id, "15m", m15);
  await upsertCandles(db, id, "1d", d1);
  const st = await getState<PollState>(db, "poll");
  st.backfill = { ...(st.backfill ?? {}), [id]: true };
  await setState(db, "poll", st);
  await recomputeStats(db, id);
  return { h: h.length, m15: m15.length, d1: d1.length };
}

/**
 * Kept deliberately light on outbound requests: the hosted worker has a per-run
 * subrequest budget, so all candles go to the database in ONE upsert and daily
 * candles are only refreshed when asked (about hourly).
 */
export async function pollPrices(db: DB, opts: { daily?: boolean } = {}) {
  const daily = opts.daily ?? true;
  const parts = await Promise.all(
    INSTRUMENTS.map(async (inst) => {
      const [m15, h, d1] = await Promise.all([
        yahoo(inst.symbol, "15m", "1d"),
        yahoo(inst.symbol, "60m", "2d"),
        daily
          ? yahoo(inst.symbol, "1d", "1mo")
          : Promise.resolve([] as Awaited<ReturnType<typeof yahoo>>),
      ]);
      return [
        ...toRows(inst.id, "15m", m15),
        ...toRows(inst.id, "1h", h),
        ...toRows(inst.id, "1d", d1),
      ];
    }),
  );
  const all = [
    ...new Map(parts.flat().map((r) => [`${r.instrument}|${r.timeframe}|${r.ts}`, r])).values(),
  ];
  for (let i = 0; i < all.length; i += 1000) {
    const { error } = await db
      .from("candles")
      .upsert(all.slice(i, i + 1000), { onConflict: "instrument,timeframe,ts" });
    if (error) throw new Error(`upsert candles: ${error.message}`);
  }
  return all.length;
}

function toRows(inst: string, tf: string, rows: Awaited<ReturnType<typeof yahoo>>) {
  return rows.map((r) => ({
    instrument: inst,
    timeframe: tf,
    ts: new Date(r.t).toISOString(),
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
  }));
}

export async function recomputeStats(db: DB, id?: string) {
  for (const inst of INSTRUMENTS) {
    if (id && inst.id !== id) continue;
    const c = await loadCandles(db, inst.id, "1h", Date.now() - 740 * 86400_000);
    if (!c.length) continue;
    const stats = computePatternStats(c);
    const { error } = await db
      .from("pattern_stats")
      .upsert({ instrument: inst.id, data: stats as any, computed_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    await cacheReactions(db, inst.id, c);
  }
}

/**
 * Historical post-report reactions need ~2 years of hourly candles, which is too many
 * reads to repeat on every 5-minute run. Compute them here (daily, per instrument) and
 * cache them in job_state as `reactions:<INSTRUMENT>` → { [eventId]: Reaction }.
 */
export async function cacheReactions(db: DB, instId: string, c1h?: Candle[]) {
  const c = c1h ?? (await loadCandles(db, instId, "1h", Date.now() - 740 * 86400_000));
  const [{ data: ev }, { data: dates }] = await Promise.all([
    db.from("events").select("*"),
    db.from("event_dates").select("*"),
  ]);
  const out: Record<string, Reaction | null> = {};
  for (const e of (ev ?? []) as EventRow[])
    if (e.instruments.includes(instId))
      out[e.id] = eventReaction(e, (dates ?? []) as EventDateRow[], c, Date.now());
  await setState(db, `reactions:${instId}`, out);
}

// ---------------- News (free RSS) ----------------
// NOTE: a social feed (e.g. X/Twitter, Reddit) could be added here later as another source
// returning {title,url,source,published}. X's API is paid, so it's intentionally not included.
// Google News RSS answers 503 / times out from the hosting provider, so headlines come
// from Bing News RSS searches plus two direct publisher feeds.
const NEWS_QUERIES = [
  "crude oil price",
  "WTI oil",
  "OPEC",
  "Strait of Hormuz oil",
  "silver price",
  "gold price",
  "Federal Reserve rates",
];
const FEEDS = [
  "https://oilprice.com/rss/main",
  "https://www.fxstreet.com/rss/news",
  ...NEWS_QUERIES.map(
    (q) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`,
  ),
];

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
const tag = (x: string, t: string) => {
  const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"));
  return m ? decode(m[1]) : "";
};

/**
 * Fetches a few feeds per run (rotating) so each scheduled run stays short.
 * Pass `all` to fetch every feed (manual button).
 */
export async function fetchNews(db: DB, opts: { all?: boolean } = {}) {
  const items: {
    url: string;
    title: string;
    title_key: string;
    source: string;
    published_at: string;
  }[] = [];
  const per = 4;
  const cur = opts.all ? null : ((await getState<{ cursor?: number }>(db, "news")).cursor ?? 0);
  const feeds =
    cur == null ? FEEDS : Array.from({ length: per }, (_, k) => FEEDS[(cur + k) % FEEDS.length]);
  const report: { feed: string; result: string }[] = [];
  await Promise.all(
    feeds.map(async (f) => {
      const host = new URL(f).hostname.replace("www.", "");
      const q = new URL(f).searchParams.get("q");
      const label = q ? `${host.split(".").at(-2)}:${q}` : host;
      try {
        const r = await fetch(f, {
          headers: {
            "User-Agent": UA,
            Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
            "Accept-Language": "en-US,en;q=0.9",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (!r.ok) {
          report.push({ feed: label, result: `HTTP ${r.status}` });
          return;
        }
        const xml = await r.text();
        const before = items.length;
        for (const it of xml
          .slice(0, 400_000)
          .split(/<item[\s>]/i)
          .slice(1, 21)) {
          let title = tag(it, "title");
          const url = tag(it, "link") || tag(it, "guid");
          if (!title || !url) continue;
          let source = tag(it, "source") || host;
          if (host.includes("google") && title.includes(" - ")) {
            const i = title.lastIndexOf(" - ");
            source = title.slice(i + 3);
            title = title.slice(0, i);
          }
          const pd = Date.parse(tag(it, "pubDate"));
          if (pd && Date.now() - pd > 2 * 86400_000) continue;
          items.push({
            url,
            title,
            title_key: title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, " ")
              .trim()
              .slice(0, 200),
            source,
            published_at: new Date(pd || Date.now()).toISOString(),
          });
        }
        report.push({ feed: label, result: `${items.length - before} items` });
      } catch (e) {
        report.push({ feed: label, result: `error: ${(e as Error).message.slice(0, 80)}` });
      }
    }),
  );
  const seenU = new Set<string>(),
    seenT = new Set<string>();
  const uniq = items.filter((i) => {
    if (seenU.has(i.url) || seenT.has(i.title_key)) return false;
    seenU.add(i.url);
    seenT.add(i.title_key);
    return true;
  });
  // One read + one write instead of one insert per headline (subrequest budget).
  const { data: existing, error: exErr } = await db
    .from("news")
    .select("url,title_key")
    .gte("published_at", new Date(Date.now() - 4 * 86400_000).toISOString())
    .limit(5000);
  if (exErr) throw new Error(`news lookup: ${exErr.message}`);
  const haveU = new Set((existing ?? []).map((r) => r.url));
  const haveT = new Set((existing ?? []).map((r) => r.title_key));
  const fresh = uniq.filter((i) => !haveU.has(i.url) && !haveT.has(i.title_key));
  let inserted = 0;
  if (fresh.length) {
    const { error } = await db
      .from("news")
      .upsert(fresh, { onConflict: "url", ignoreDuplicates: true });
    if (error) {
      // Rare race on title_key: fall back to small per-row inserts for at most 15 rows.
      for (const row of fresh.slice(0, 15))
        if (!(await db.from("news").insert(row)).error) inserted++;
    } else inserted = fresh.length;
  }
  await setState(db, "news", {
    cursor: cur == null ? 0 : (cur + per) % FEEDS.length,
    at: new Date().toISOString(),
    report,
    fetched: uniq.length,
    inserted,
  });
  return { fetched: uniq.length, inserted };
}

const TagSchema = z.object({
  items: z.array(
    z.object({
      i: z.number(),
      wti: z.enum(["bullish", "bearish", "neutral", "none"]),
      silver: z.enum(["bullish", "bearish", "neutral", "none"]),
      gold: z.enum(["bullish", "bearish", "neutral", "none"]),
      impact: z.number(),
      reason: z.string(),
    }),
  ),
});

export async function tagNews(db: DB) {
  const ai = await getState<{ pausedUntil?: number; reason?: string }>(db, "ai");
  if (ai.pausedUntil && ai.pausedUntil > Date.now()) return { skipped: ai.reason };
  const { data: rows } = await db
    .from("news")
    .select("id,title,source")
    .eq("tagged", false)
    .order("published_at", { ascending: false })
    .limit(10);
  if (!rows?.length) return { tagged: 0 };
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const list = rows.map((r, i) => `${i}. ${r.title} (${r.source ?? ""})`).join("\n");
  try {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      instructions:
        "You are a commodities analyst. For each headline, judge the likely short-term price impact on WTI crude oil, silver and gold. Use 'none' if the headline is irrelevant to that instrument. impact is 1 (trivial) to 5 (market-moving). reason is one short line (<=15 words).",
      messages: [{ role: "user", content: `Headlines:\n${list}` }],
      output: Output.object({ schema: TagSchema }),
      providerOptions: { openai: { store: false, reasoningEffort: "low" } },
    });
    const out = await result.output;
    for (const it of out.items) {
      const row = rows[it.i];
      if (!row) continue;
      const sentiment: Record<string, string> = {};
      const instruments: string[] = [];
      for (const [k, id] of [
        ["wti", "WTI"],
        ["silver", "SILVER"],
        ["gold", "GOLD"],
      ] as const) {
        if (it[k] !== "none") {
          sentiment[id] = it[k];
          instruments.push(id);
        }
      }
      await db
        .from("news")
        .update({
          tagged: true,
          sentiment,
          instruments,
          impact: Math.max(1, Math.min(5, Math.round(it.impact))),
          reason: it.reason,
        })
        .eq("id", row.id);
    }
    return { tagged: out.items.length };
  } catch (e: any) {
    const status = e?.statusCode ?? e?.cause?.statusCode;
    if (status === 402 || status === 403) {
      await setState(db, "ai", {
        pausedUntil: Date.now() + 6 * 3600_000,
        reason: `AI ${status}: ${e.message}`,
      });
    } else if (status === 429) {
      await setState(db, "ai", { pausedUntil: Date.now() + 15 * MIN, reason: "rate limited" });
    }
    throw e;
  }
}

// ---------------- WhatsApp via CallMeBot ----------------
export async function sendWhatsApp(text: string) {
  const phone = process.env.CALLMEBOT_PHONE;
  const apikey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apikey) throw new Error("CALLMEBOT_PHONE / CALLMEBOT_APIKEY secrets are not set");
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const body = await r.text();
  if (!r.ok || /error|invalid/i.test(body.slice(0, 300)))
    throw new Error(`CallMeBot ${r.status}: ${body.replace(/<[^>]+>/g, " ").slice(0, 200)}`);
}

interface Settings {
  alert_types: Record<string, Record<string, boolean>>;
  sudden_x: number;
  cooldown_min: number;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
}

function inQuiet(s: Settings, now: number) {
  if (!s.quiet_enabled) return false;
  const p = tzParts(now, "Asia/Dubai");
  const m = p.h * 60 + p.mi;
  const [a1, a2] = s.quiet_start.split(":").map(Number);
  const [b1, b2] = s.quiet_end.split(":").map(Number);
  const a = a1 * 60 + a2,
    b = b1 * 60 + b2;
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

export function alertEnabled(s: Settings, type: string, inst: string) {
  return s.alert_types?.[type]?.[inst] !== false; // default on
}

async function emit(
  db: DB,
  s: Settings,
  type: AlertTypeId,
  inst: string | null,
  dedupe: string,
  message: string,
  now: number,
) {
  if (inst && !alertEnabled(s, type, inst)) return;
  // cooldown: max 1 alert of same type per instrument per cooldown window
  const since = new Date(now - s.cooldown_min * MIN).toISOString();
  let q = db
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("type", type)
    .gte("created_at", since)
    .eq("status", "sent");
  q = inst ? q.eq("instrument", inst) : q.is("instrument", null);
  const { count } = await q;
  if ((count ?? 0) > 0) return;
  const quiet = inQuiet(s, now);
  const { error } = await db.from("alerts").insert({
    type,
    instrument: inst,
    dedupe_key: dedupe,
    message,
    status: quiet ? "quiet" : "pending",
  });
  if (error) return; // duplicate dedupe key => already handled
  if (quiet) return;
  try {
    await sendWhatsApp(message);
    await db.from("alerts").update({ status: "sent" }).eq("dedupe_key", dedupe);
  } catch (e) {
    await db
      .from("alerts")
      .update({ status: "failed", error: (e as Error).message })
      .eq("dedupe_key", dedupe);
  }
}

const arrow = (x: number) => (x >= 0 ? "↑" : "↓");
const sgn = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;

export async function runAlerts(db: DB, now = Date.now()) {
  const { data: sRow } = await db.from("settings").select("*").eq("id", 1).single();
  const s = sRow as unknown as Settings;
  const snap = await buildSnapshot(db, now);
  const td = tradingDayOf(now);
  const w = sessionWindows(td.y, td.m, td.d);
  const day = w.key;
  const prevBias = await getState<Record<string, string>>(db, "bias");
  const newBias: Record<string, string> = {};

  for (const x of snap.instruments) {
    const inst = getInstrument(x.id)!;
    const tag = `${inst.emoji} ${inst.short}`;
    const sentTxt =
      x.sent24.bullPct != null ? ` | News ${x.sent24.bullPct.toFixed(0)}% bullish` : "";
    const biasTxt = ` | Bias: ${x.bias.label} ${x.bias.confidence}`;

    // 1) Session heads-up at NY open
    if (now >= w.nyOpen && now < w.nyOpen + 20 * MIN && x.headsUp?.clear) {
      const h = x.headsUp;
      await emit(
        db,
        s,
        "headsup",
        x.id,
        `headsup:${x.id}:${day}`,
        `${tag} | NY open | London ${arrow(h.londonMove)} ${sgn(h.londonMove)} | NY continued London ${h.rate?.toFixed(0)}% (n=${h.n})${sentTxt}${biasTxt}`,
        now,
      );
    }
    // 2) Sweep / BOS in first hour after London or NY open
    const nearOpen =
      (now >= w.londonOpen && now < w.londonOpen + 60 * MIN) ||
      (now >= w.nyOpen && now < w.nyOpen + 60 * MIN);
    if (nearOpen) {
      for (const f of x.flags.filter((f) => f.at >= now - 30 * MIN)) {
        await emit(
          db,
          s,
          "structure",
          x.id,
          `structure:${x.id}:${day}:${f.level}:${f.side}:${f.kind}`,
          `${tag} | ${currentSession(now)} | ${f.kind === "bos" ? "🧱" : "🎯"} ${f.text} @ ${f.price.toFixed(inst.decimals)}${biasTxt}`,
          now,
        );
      }
    }
    // 3) Sudden move: last 15m range > X × avg hourly range
    if (x.last15 && x.avgHourRange && now - x.last15.t < 20 * MIN) {
      const r = x.last15.h - x.last15.l;
      if (r > s.sudden_x * x.avgHourRange) {
        const mv = ((x.last15.c - x.last15.o) / x.last15.o) * 100;
        await emit(
          db,
          s,
          "sudden",
          x.id,
          `sudden:${x.id}:${x.last15.t}`,
          `⚡ ${tag} | Sudden ${mv >= 0 ? "🟢 surge" : "🔴 drop"} ${sgn(mv)} in 15m (${(r / x.avgHourRange).toFixed(1)}× avg hourly range) | ${x.last?.toFixed(inst.decimals)}`,
          now,
        );
      }
    }
    // 7) Bias flip
    newBias[x.id] = x.bias.label;
    const pb = prevBias[x.id];
    if (pb && pb !== x.bias.label && x.bias.label !== "Neutral") {
      await emit(
        db,
        s,
        "biasflip",
        x.id,
        `biasflip:${x.id}:${Math.floor(now / (15 * MIN))}`,
        `🔄 ${tag} | Bias flip ${pb} → ${x.bias.label === "Bullish" ? "🟢" : "🔴"} ${x.bias.label} ${x.bias.confidence}`,
        now,
      );
    }
  }
  await setState(db, "bias", newBias);

  // 4) & 5) Events
  for (const u of snap.upcoming) {
    const mins = (u.ts - now) / MIN;
    for (const id of u.event.instruments) {
      const inst = getInstrument(id)!;
      if (mins > 25 && mins <= 35) {
        const r = u.reactions[id];
        await emit(
          db,
          s,
          "prereport",
          id,
          `pre:${u.event.id}:${u.ts}:${id}`,
          `⏰ ${inst.emoji} ${inst.short} | ${u.event.name} in 30m (${fmtDubaiTime(u.ts)} Dubai) | ${reactionText(u.event.name, inst.short, r)}`,
          now,
        );
      }
      if (mins <= -60 && mins > -75) {
        const c = await loadCandles(db, id, "15m", u.ts - 20 * MIN);
        const base = c.find((k) => k.t <= u.ts && k.t + 15 * MIN > u.ts) ?? c[0];
        const last = c.at(-1);
        if (base && last) {
          const mv = ((last.c - base.o) / base.o) * 100;
          await emit(
            db,
            s,
            "postreport",
            id,
            `post:${u.event.id}:${u.ts}:${id}`,
            `📊 ${inst.emoji} ${inst.short} | ${u.event.name} reaction 1h: ${mv >= 0 ? "🟢" : "🔴"} ${sgn(mv)} | now ${last.c.toFixed(inst.decimals)}`,
            now,
          );
        }
      }
    }
  }

  // 6) Strong news
  const { data: strong } = await db
    .from("news")
    .select("id,title,sentiment,instruments,impact,reason")
    .eq("tagged", true)
    .eq("alerted", false)
    .gte("impact", 4)
    .gte("published_at", new Date(now - 3 * 3600_000).toISOString())
    .limit(5);
  for (const n of strong ?? []) {
    await db.from("news").update({ alerted: true }).eq("id", n.id);
    for (const id of n.instruments) {
      const inst = getInstrument(id);
      if (!inst) continue;
      const sDir = (n.sentiment as Record<string, string>)[id];
      const e = sDir === "bullish" ? "🟢" : sDir === "bearish" ? "🔴" : "⚪";
      await emit(
        db,
        s,
        "news",
        id,
        `news:${n.id}:${id}`,
        `📰 ${inst.emoji} ${inst.short} | ${e} ${sDir} · impact ${n.impact} | ${n.title.slice(0, 120)} — ${n.reason ?? ""}`,
        now,
      );
    }
  }
}

// ---------------- Orchestrator (called every 2 min) ----------------
async function isHot(db: DB, now: number) {
  const keys = keyTimesAround(now);
  const { data: ev } = await db.from("events").select("*").eq("enabled", true);
  const { data: dates } = await db
    .from("event_dates")
    .select("*")
    .gte("ts", new Date(now - 2 * 3600_000).toISOString())
    .lte("ts", new Date(now + 2 * 3600_000).toISOString());
  const { occurrences } = await import("./engine");
  for (const e of ev ?? [])
    keys.push(
      ...occurrences(e as any, (dates ?? []) as any, now - 2 * 3600_000, now + 2 * 3600_000),
    );
  return keys.some((t) => now >= t - 30 * MIN && now <= t + 60 * MIN);
}

/** One bounded phase per call so each run stays short. */
export async function tick(db: DB, now = Date.now()) {
  const { data: locked } = await db.rpc("try_job_lock", { _name: "tick", _seconds: 100 });
  if (!locked) return { skipped: "locked" };
  const st = await getState<PollState>(db, "poll");
  const done: string[] = [];
  try {
    const missing = INSTRUMENTS.find((i) => !st.backfill?.[i.id]);
    const open = isMarketOpen(now);
    const hot = open && (await isHot(db, now));
    const priceDue = open && (hot || !st.lastPrice || now - st.lastPrice >= 14 * MIN);
    const newsDue = !st.lastNews || now - st.lastNews >= 14 * MIN;
    const ny = tzParts(now, NY_TZ);
    const statsDue =
      ny.h >= 17 && ny.wd >= 1 && ny.wd <= 5 && st.statsDay !== `${ny.y}-${ny.m}-${ny.d}`;
    // Rotate phases so news/tagging still run during hot windows.
    const cands = [priceDue && "prices", newsDue && "news", statsDue && "stats", "tag"].filter(
      Boolean,
    ) as string[];
    const phase = cands.find((c) => c !== st.lastPhase) ?? cands[0];
    await setState(db, "poll", { ...st, lastPhase: phase });

    const { data: rx } = await db.from("job_state").select("key").like("key", "reactions:%");
    const noRx = INSTRUMENTS.find((i) => !(rx ?? []).some((r) => r.key === `reactions:${i.id}`));
    if (missing) {
      await backfillInstrument(db, missing.id);
      done.push(`backfill:${missing.id}`);
    } else if (noRx) {
      await cacheReactions(db, noRx.id);
      done.push(`reactions:${noRx.id}`);
    } else if (phase === "prices") {
      const daily = !st.lastDaily || now - st.lastDaily >= 55 * MIN;
      await pollPrices(db, { daily });
      const s2 = await getState<PollState>(db, "poll");
      await setState(db, "poll", {
        ...s2,
        lastPrice: now,
        ...(daily ? { lastDaily: now } : {}),
        lastError: undefined,
      });
      done.push("prices");
      await runAlerts(db, now);
      done.push("alerts");
    } else if (phase === "news") {
      const r = await fetchNews(db);
      const s2 = await getState<PollState>(db, "poll");
      await setState(db, "poll", { ...s2, lastNews: now });
      done.push(`news:${r.inserted}`);
    } else if (phase === "stats") {
      // One instrument per run keeps each run inside the request budget.
      const dayKey = `${ny.y}-${ny.m}-${ny.d}`;
      const next = INSTRUMENTS.find((i) => st.statsDone?.[i.id] !== dayKey);
      if (next) await recomputeStats(db, next.id);
      const s2 = await getState<PollState>(db, "poll");
      const statsDone = { ...(s2.statsDone ?? {}), ...(next ? { [next.id]: dayKey } : {}) };
      const all = INSTRUMENTS.every((i) => statsDone[i.id] === dayKey);
      await setState(db, "poll", { ...s2, statsDone, ...(all ? { statsDay: dayKey } : {}) });
      done.push(`stats:${next?.id ?? "-"}`);
    } else {
      const r = await tagNews(db);
      done.push(`tag:${JSON.stringify(r)}`);
    }
    const s3 = await getState<PollState>(db, "poll");
    await setState(db, "poll", {
      ...s3,
      lastRun: {
        phase,
        at: new Date(now).toISOString(),
        ms: Date.now() - now,
        ok: true,
        info: done.join(","),
      },
    });
    return { done, hot };
  } catch (e) {
    const s2 = await getState<PollState>(db, "poll");
    await setState(db, "poll", {
      ...s2,
      lastError: `${new Date(now).toISOString()} ${(e as Error).message}`,
    });
    throw e;
  } finally {
    await db
      .from("job_state")
      .update({ value: { until: new Date(0).toISOString() } })
      .eq("key", "lock:tick");
  }
}
