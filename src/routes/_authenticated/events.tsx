import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { getEventsView, saveEvent, saveEventDate } from "@/lib/manage.functions";
import { reactionText, type EventRow, type Reaction, type ReactionGroup } from "@/lib/engine";
import { radarHead } from "@/lib/radar-ui";
import { fmtCountdown, fmtDubai } from "@/lib/time";
import { Empty, LoadError, PageTitle, RefreshButton, useClock } from "@/components/radar-common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const eventsQuery = queryOptions({
  queryKey: ["events-view"],
  queryFn: () => getEventsView(),
  refetchInterval: 300_000,
});

export const Route = createFileRoute("/_authenticated/events")({
  head: () => radarHead("Events", "Scheduled reports, countdowns and historical price reactions."),
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery),
  errorComponent: LoadError,
  notFoundComponent: () => <p>No events found</p>,
  component: Events,
});

type View = Awaited<ReturnType<typeof getEventsView>>;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const INSTS = ["WTI", "SILVER", "GOLD"] as const;

function signed(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function GroupLine({ label, g }: { label: string; g: ReactionGroup | null }) {
  if (!g) return null;
  return (
    <div className="flex flex-wrap justify-between gap-2 text-xs">
      <span className="text-muted-foreground">
        {label} · n={g.n}
      </span>
      <span className="num">
        1h <span className={g.avg1h >= 0 ? "text-up" : "text-down"}>{signed(g.avg1h)}</span> (±
        {g.avgAbs1h.toFixed(2)}%, up {g.up1h.toFixed(0)}%) · 3h{" "}
        <span className={g.avg3h >= 0 ? "text-up" : "text-down"}>{signed(g.avg3h)}</span>
      </span>
    </div>
  );
}

function expected(
  inst: string,
  name: string,
  r: Reaction | null,
  s24: { bullPct: number | null; n: number } | undefined,
) {
  const base = reactionText(name, inst, r);
  if (!s24 || s24.bullPct == null || s24.n < 3) return base;
  const tone = s24.bullPct >= 60 ? "bullish" : s24.bullPct <= 40 ? "bearish" : "mixed";
  return `${base} News going in is ${tone} (${s24.bullPct.toFixed(0)}% bullish, ${s24.n} headlines).`;
}

function Events() {
  const { data } = useSuspenseQuery(eventsQuery);
  const now = useClock(data.now);
  const [editing, setEditing] = useState<EventRow | "new" | null>(null);
  return (
    <>
      <PageTitle
        title="Reports & events"
        subtitle="Countdowns and how price reacted after past releases."
      >
        <RefreshButton />
      </PageTitle>
      <section>
        <h2 className="mb-4 text-lg font-semibold">Next 7 days</h2>
        {!data.upcoming.length ? (
          <Empty
            title="No upcoming events"
            message="Enable recurring events below or add confirmed dates."
          />
        ) : (
          data.upcoming.map((u) => (
            <UpcomingCard
              key={`${u.event.id}-${u.ts}`}
              u={u}
              now={now}
              sentiment={data.sentiment}
            />
          ))
        )}
      </section>
      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recurring events</h2>
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus />
            Add
          </Button>
        </div>
        {editing === "new" && <EventForm onDone={() => setEditing(null)} />}
        {data.events.map((e) =>
          editing !== "new" && editing?.id === e.id ? (
            <EventForm key={e.id} ev={e} onDone={() => setEditing(null)} />
          ) : (
            <div
              key={e.id}
              className="flex items-center justify-between gap-3 border-t border-border py-3"
            >
              <div className="min-w-0">
                <p className={`text-sm ${e.enabled ? "" : "text-muted-foreground line-through"}`}>
                  {e.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.rule === "weekly"
                    ? `Every ${WEEKDAYS[e.weekday ?? 0]}`
                    : e.rule === "first_friday"
                      ? "First Friday"
                      : "Manual dates"}{" "}
                  · {e.local_time} {e.tz.split("/")[1].replace("_", " ")} ·{" "}
                  {e.instruments.join("/")} · impact {e.impact}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit ${e.name}`}
                onClick={() => setEditing(e)}
              >
                <Pencil />
              </Button>
            </div>
          ),
        )}
      </section>
    </>
  );
}

function UpcomingCard({
  u,
  now,
  sentiment,
}: {
  u: View["upcoming"][number];
  now: number;
  sentiment: View["sentiment"];
}) {
  const [open, setOpen] = useState(false);
  const past = u.ts <= now;
  return (
    <article className="panel mb-4 p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{u.event.name}</h3>
        <span className={`num text-sm ${past ? "text-muted-foreground" : "text-warn"}`}>
          {past ? "RELEASED" : `IN ${fmtCountdown(u.ts - now)}`}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        {fmtDubai(u.ts)} Dubai · impact {u.event.impact}/5
        {u.event.context_only ? " · context only" : ""}
        {u.date && (u.date.consensus != null || u.date.actual != null) && (
          <>
            {" "}
            · cons {u.date.consensus ?? "—"} / prev {u.date.previous ?? "—"} / actual{" "}
            {u.date.actual ?? "—"}
          </>
        )}
      </p>
      {u.event.instruments.map((id) => {
        const r = u.reactions[id] ?? null;
        return (
          <div key={id} className="border-t border-border py-3">
            <p className="mb-1 text-xs text-primary">{id}</p>
            <GroupLine label="All releases" g={r?.all ?? null} />
            <GroupLine label="Actual > consensus" g={r?.above ?? null} />
            <GroupLine label="Actual < consensus" g={r?.below ?? null} />
            <p className="mt-2 rounded-md bg-primary/5 p-2 text-xs leading-relaxed">
              <span className="font-medium text-primary">Expected after the report: </span>
              {expected(id, u.event.name, r, sentiment[id]?.s24)}
            </p>
          </div>
        );
      })}
      <Button size="sm" variant="ghost" className="mt-1 px-0" onClick={() => setOpen(!open)}>
        {open ? "Close" : "Enter consensus / actual"}
      </Button>
      {open && (
        <DateForm eventId={u.event.id} ts={u.ts} initial={u.date} onDone={() => setOpen(false)} />
      )}
    </article>
  );
}

function num(v: string) {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function DateForm({
  eventId,
  ts,
  initial,
  onDone,
}: {
  eventId: string;
  ts: number;
  initial: View["upcoming"][number]["date"];
  onDone: () => void;
}) {
  const save = useServerFn(saveEventDate);
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({
    consensus: String(initial?.consensus ?? ""),
    previous: String(initial?.previous ?? ""),
    actual: String(initial?.actual ?? ""),
    notes: initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await save({
        data: {
          ...(initial?.id ? { id: initial.id } : {}),
          event_id: eventId,
          ts: new Date(ts).toISOString(),
          consensus: num(f.consensus),
          previous: num(f.previous),
          actual: num(f.actual),
          notes: f.notes.trim() || null,
        },
      });
      await qc.invalidateQueries();
      await router.invalidate();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 grid grid-cols-3 gap-2">
      {(["consensus", "previous", "actual"] as const).map((k) => (
        <label key={k} className="text-xs capitalize">
          {k}
          <Input
            className="mt-1"
            inputMode="decimal"
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: e.target.value })}
          />
        </label>
      ))}
      <label className="col-span-3 text-xs">
        Notes
        <Input
          className="mt-1"
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
        />
      </label>
      {err && (
        <p role="alert" className="col-span-3 text-xs text-down">
          {err}
        </p>
      )}
      <Button className="col-span-3" size="sm" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function EventForm({ ev, onDone }: { ev?: EventRow; onDone: () => void }) {
  const save = useServerFn(saveEvent);
  const qc = useQueryClient();
  const router = useRouter();
  const [f, setF] = useState({
    name: ev?.name ?? "",
    rule: (ev?.rule ?? "weekly") as "manual" | "weekly" | "first_friday",
    weekday: ev?.weekday ?? 3,
    local_time: ev?.local_time?.slice(0, 5) ?? "10:30",
    tz: (ev?.tz ?? "America/New_York") as "America/New_York" | "Asia/Dubai" | "Europe/London",
    instruments: (ev?.instruments ?? ["WTI"]) as ("WTI" | "SILVER" | "GOLD")[],
    impact: ev?.impact ?? 3,
    context_only: ev?.context_only ?? false,
    higher_is_bullish: ev?.higher_is_bullish ?? false,
    enabled: ev?.enabled ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await save({
        data: {
          ...(ev ? { id: ev.id } : {}),
          ...f,
          weekday: f.rule === "weekly" ? f.weekday : null,
        },
      });
      await qc.invalidateQueries();
      await router.invalidate();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  const sel = "mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <form onSubmit={submit} className="panel mb-4 grid grid-cols-2 gap-3 p-4">
      <label className="col-span-2 text-xs">
        Name
        <Input
          className="mt-1"
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
      </label>
      <label className="text-xs">
        Repeats
        <select
          className={sel}
          value={f.rule}
          onChange={(e) => setF({ ...f, rule: e.target.value as typeof f.rule })}
        >
          <option value="weekly">Weekly</option>
          <option value="first_friday">First Friday</option>
          <option value="manual">Manual dates only</option>
        </select>
      </label>
      <label className="text-xs">
        Weekday
        <select
          className={sel}
          disabled={f.rule !== "weekly"}
          value={f.weekday}
          onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}
        >
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Time
        <Input
          className="mt-1"
          type="time"
          required
          value={f.local_time}
          onChange={(e) => setF({ ...f, local_time: e.target.value })}
        />
      </label>
      <label className="text-xs">
        Time zone
        <select
          className={sel}
          value={f.tz}
          onChange={(e) => setF({ ...f, tz: e.target.value as typeof f.tz })}
        >
          <option value="America/New_York">New York</option>
          <option value="Europe/London">London</option>
          <option value="Asia/Dubai">Dubai</option>
        </select>
      </label>
      <fieldset className="col-span-2 text-xs">
        <legend className="mb-1">Instruments</legend>
        <div className="flex gap-2">
          {INSTS.map((id) => {
            const on = f.instruments.includes(id);
            return (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={on ? "secondary" : "outline"}
                aria-pressed={on}
                onClick={() =>
                  setF({
                    ...f,
                    instruments: on
                      ? f.instruments.filter((x) => x !== id)
                      : [...f.instruments, id],
                  })
                }
              >
                {id}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <label className="text-xs">
        Impact (1–5)
        <Input
          className="mt-1"
          type="number"
          min={1}
          max={5}
          value={f.impact}
          onChange={(e) =>
            setF({ ...f, impact: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })
          }
        />
      </label>
      <div className="flex flex-col justify-end gap-2 text-xs">
        <label className="flex items-center justify-between gap-2">
          Enabled
          <Switch checked={f.enabled} onCheckedChange={(v) => setF({ ...f, enabled: v })} />
        </label>
        <label className="flex items-center justify-between gap-2">
          Context only
          <Switch
            checked={f.context_only}
            onCheckedChange={(v) => setF({ ...f, context_only: v })}
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          Higher = bullish
          <Switch
            checked={f.higher_is_bullish}
            onCheckedChange={(v) => setF({ ...f, higher_is_bullish: v })}
          />
        </label>
      </div>
      {err && (
        <p role="alert" className="col-span-2 text-xs text-down">
          {err}
        </p>
      )}
      <div className="col-span-2 flex gap-2">
        <Button size="sm" disabled={busy || !f.instruments.length}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
