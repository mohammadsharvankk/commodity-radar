import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadEvents } from "./analysis";

export const getAccountAvailability = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error("Unable to check account availability");
  return { canRegister: data.users.length === 0 };
});
export const getEvents = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => loadEvents(context.supabase));
export const getSettings = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.from("settings").select("*").eq("id", 1).single();
  if (error) throw new Error(error.message);
  return data;
});
export const getAlerts = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data, error } = await context.supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return data ?? [];
});
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const saveSettings = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ sudden_x: z.number().min(0.1).max(20), cooldown_min: z.number().int().min(1).max(1440), quiet_enabled: z.boolean(), quiet_start: clock, quiet_end: clock, alert_types: z.record(z.record(z.boolean())) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("settings").update({ ...data, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const saveEvent = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(160), rule: z.enum(["manual", "weekly", "first_friday"]), weekday: z.number().int().min(0).max(6).nullable(), local_time: clock, tz: z.enum(["America/New_York", "Asia/Dubai", "Europe/London"]), instruments: z.array(z.enum(["WTI", "SILVER", "GOLD"])).min(1), impact: z.number().int().min(1).max(5), context_only: z.boolean(), higher_is_bullish: z.boolean(), enabled: z.boolean() }).refine(d => d.rule !== "weekly" || d.weekday !== null, "Select a weekday"))
  .handler(async ({ data, context }) => {
    const { id, ...row } = data;
    const result = id ? await context.supabase.from("events").update(row).eq("id", id) : await context.supabase.from("events").insert(row);
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });
export const saveEventDate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid().optional(), event_id: z.string().uuid(), ts: z.string().datetime(), consensus: z.number().finite().nullable(), previous: z.number().finite().nullable(), actual: z.number().finite().nullable(), notes: z.string().max(1000).nullable() }))
  .handler(async ({ data, context }) => {
    const { id: _id, ...rest } = data;
    const result = await context.supabase.from("event_dates").upsert(rest, { onConflict: "event_id,ts" });
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });
export const getEventsView = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { buildSnapshot } = await import("./analysis");
  const [base, snap] = await Promise.all([loadEvents(context.supabase), buildSnapshot(context.supabase as any)]);
  const sentiment = Object.fromEntries(snap.instruments.map((i) => [i.id, { s6: i.sent6, s24: i.sent24 }]));
  const out = { ...base, upcoming: snap.upcoming, sentiment, now: snap.now };
  return JSON.parse(JSON.stringify(out)) as typeof out;
});
