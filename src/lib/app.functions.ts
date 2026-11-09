import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildSnapshot, loadCandles, loadNews, loadStats } from "./analysis";
import { INSTRUMENT_IDS } from "./instruments";

export const getSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const snap = await buildSnapshot(context.supabase as any);
    return JSON.parse(JSON.stringify(snap)) as typeof snap;
  });

export const getDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; tf: string }) =>
    z
      .object({
        id: z.enum(INSTRUMENT_IDS as [string, ...string[]]),
        tf: z.enum(["15m", "1h", "4h", "1d"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const days = data.tf === "15m" ? 10 : data.tf === "1d" ? 365 : data.tf === "4h" ? 120 : 30;
    const tf = data.tf === "4h" ? "1h" : data.tf;
    const candles = await loadCandles(db, data.id, tf, Date.now() - days * 86400_000);
    return { candles };
  });

export const getPatterns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const m = await loadStats(context.supabase as any);
    return JSON.parse(JSON.stringify(m)) as typeof m;
  });

export const getNewsFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    loadNews(context.supabase as any, Date.now() - 3 * 86400_000, 300),
  );

export const getJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("job_state").select("key,value,updated_at");
    return {
      state: (data ?? []).filter((r) => !r.key.startsWith("lock:")) as {
        key: string;
        value: any;
        updated_at: string;
      }[],
      secretsSet: !!process.env.CALLMEBOT_PHONE && !!process.env.CALLMEBOT_APIKEY,
    };
  });

export const sendTestAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendWhatsApp } = await import("./jobs.server");
    const msg = "✅ Commodity Radar test alert — WhatsApp alerts are working.";
    try {
      await sendWhatsApp(msg);
      await supabaseAdmin.from("alerts").insert({ type: "test", message: msg, status: "sent" });
      return { ok: true as const, error: null };
    } catch (e) {
      await supabaseAdmin
        .from("alerts")
        .insert({ type: "test", message: msg, status: "failed", error: (e as Error).message });
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const runJobNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { job: string; instrument?: string }) =>
    z
      .object({
        job: z.enum(["prices", "news", "tag", "stats", "backfill"]),
        instrument: z.enum(INSTRUMENT_IDS as [string, ...string[]]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const j = await import("./jobs.server");
    try {
      if (data.job === "prices") await j.pollPrices(db);
      if (data.job === "news") await j.fetchNews(db, { all: true });
      if (data.job === "tag") await j.tagNews(db);
      if (data.job === "stats") await j.recomputeStats(db);
      if (data.job === "backfill")
        for (const id of data.instrument ? [data.instrument] : INSTRUMENT_IDS)
          await j.backfillInstrument(db, id);
      return { ok: true, error: null as string | null };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
