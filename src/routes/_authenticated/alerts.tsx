import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { CheckCircle2, CircleAlert, Play, Send } from "lucide-react";
import { getJobStatus, runJobNow, saveWhatsApp, sendTestAlert } from "@/lib/app.functions";
import { getAlerts, getSettings, saveSettings } from "@/lib/manage.functions";
import { ALERT_TYPES, INSTRUMENT_IDS } from "@/lib/instruments";
import { radarHead } from "@/lib/radar-ui";
import { fmtDubai } from "@/lib/time";
import { Empty, LoadError, PageTitle, RefreshButton } from "@/components/radar-common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const settingsQuery = queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });
const alertsQuery = queryOptions({
  queryKey: ["alerts"],
  queryFn: () => getAlerts(),
  refetchInterval: 120_000,
});
const statusQuery = queryOptions({
  queryKey: ["job-status"],
  queryFn: () => getJobStatus(),
  refetchInterval: 60_000,
});

export const Route = createFileRoute("/_authenticated/alerts")({
  head: () => radarHead("Alerts & settings", "WhatsApp alerts, data jobs and alert history."),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(alertsQuery),
      context.queryClient.ensureQueryData(statusQuery),
    ]),
  errorComponent: LoadError,
  notFoundComponent: () => <p>Not found</p>,
  component: AlertsPage,
});

function AlertsPage() {
  return (
    <>
      <PageTitle title="Alerts & settings" subtitle="WhatsApp heads-ups, data jobs and history.">
        <RefreshButton />
      </PageTitle>
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-10">
          <WhatsAppSection />
          <DataSection />
        </div>
        <div className="space-y-10">
          <SettingsSection />
          <HistorySection />
        </div>
      </div>
    </>
  );
}

function WhatsAppSection() {
  const { data } = useSuspenseQuery(statusQuery);
  const test = useServerFn(sendTestAlert);
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">WhatsApp</h2>
      <p
        className={`mb-4 flex items-center gap-2 text-sm ${data.secretsSet ? "text-up" : "text-warn"}`}
      >
        {data.secretsSet ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
        {data.secretsSet
          ? "WhatsApp configured"
          : "WhatsApp not configured. Alerts are logged below but not sent."}
      </p>
      <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Open callmebot.com → WhatsApp API and save the bot's current phone number in your contacts
          (it changes from time to time).
        </li>
        <li>
          Send it this WhatsApp message:{" "}
          <span className="num text-foreground">I allow callmebot to send me messages</span>
        </li>
        <li>Wait up to 2 minutes for the reply with your API key.</li>
        <li>Enter your WhatsApp number and that key below, then Save.</li>
        <li>Press Send test alert.</li>
      </ol>
      <WhatsAppForm current={data.whatsappPhone} />
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg("");
          try {
            const r = await test();
            setMsg(r.ok ? "Test alert sent. Check WhatsApp." : `Failed: ${r.error}`);
            await qc.invalidateQueries({ queryKey: ["alerts"] });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Send />
        {busy ? "Sending…" : "Send test alert"}
      </Button>
      {msg && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {msg}
        </p>
      )}
    </section>
  );
}

function WhatsAppForm({ current }: { current: string | null }) {
  const save = useServerFn(saveWhatsApp);
  const qc = useQueryClient();
  const [phone, setPhone] = useState("");
  const [apikey, setApikey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <form
      className="mb-4 grid gap-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg("");
        try {
          await save({ data: { phone, apikey } });
          setApikey("");
          setMsg("Saved. Now press Send test alert.");
          await qc.invalidateQueries({ queryKey: ["job-status"] });
        } catch (err) {
          setMsg(err instanceof Error ? err.message : "Save failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="text-xs">
        WhatsApp number (with country code)
        <Input
          className="mt-1"
          inputMode="tel"
          placeholder={current ?? "9715XXXXXXXX"}
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label className="text-xs">
        CallMeBot API key
        <Input
          className="mt-1"
          autoComplete="off"
          required
          value={apikey}
          onChange={(e) => setApikey(e.target.value)}
        />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button size="sm" variant="outline" disabled={busy}>
          {busy ? "Saving…" : current ? "Update WhatsApp details" : "Save WhatsApp details"}
        </Button>
        {msg && (
          <span role="status" className="text-xs text-muted-foreground">
            {msg}
          </span>
        )}
      </div>
    </form>
  );
}

function DataSection() {
  const { data } = useSuspenseQuery(statusQuery);
  const run = useServerFn(runJobNow);
  const qc = useQueryClient();
  const router = useRouter();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const poll = (data.state.find((s) => s.key === "poll")?.value ?? {}) as {
    lastPrice?: number;
    lastNews?: number;
    backfill?: Record<string, boolean>;
    lastError?: string;
  };
  async function go(
    steps: {
      job: "prices" | "news" | "tag" | "stats" | "backfill";
      instrument?: string;
      label: string;
    }[],
  ) {
    setBusy(true);
    setLog([]);
    try {
      for (const s of steps) {
        setLog((l) => [...l, `${s.label}…`]);
        const r = await run({
          data: { job: s.job, ...(s.instrument ? { instrument: s.instrument } : {}) },
        });
        setLog((l) => [...l.slice(0, -1), `${s.label}: ${r.ok ? "done" : `failed (${r.error})`}`]);
        if (!r.ok) break;
      }
      await qc.invalidateQueries();
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }
  const backfillSteps = [
    ...INSTRUMENT_IDS.map((id) => ({
      job: "backfill" as const,
      instrument: id,
      label: `Backfill 2y ${id}`,
    })),
    { job: "stats" as const, label: "Compute pattern stats" },
  ];
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Data jobs</h2>
      <dl className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">History loaded</dt>
          <dd className="num">
            {INSTRUMENT_IDS.map((id) => `${id} ${poll.backfill?.[id] ? "✓" : "–"}`).join("  ")}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Last price update</dt>
          <dd className="num">{poll.lastPrice ? fmtDubai(poll.lastPrice) : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Last news fetch</dt>
          <dd className="num">{poll.lastNews ? fmtDubai(poll.lastNews) : "—"}</dd>
        </div>
        {poll.lastError && <div className="text-xs text-down">Last error: {poll.lastError}</div>}
      </dl>
      <p className="mb-3 text-xs text-muted-foreground">
        The background schedule runs these automatically. Use the buttons to run them now.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => go(backfillSteps)}>
          <Play />
          Load 2-year history + backtest
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => go([{ job: "prices", label: "Update prices" }])}
        >
          Prices
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            go([
              { job: "news", label: "Fetch news" },
              { job: "tag", label: "AI sentiment tagging" },
            ])
          }
        >
          News + sentiment
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => go([{ job: "stats", label: "Compute pattern stats" }])}
        >
          Recompute stats
        </Button>
      </div>
      {!!log.length && (
        <ul className="mt-3 space-y-1 text-xs">
          {log.map((l, i) => (
            <li key={i} className="num">
              {l}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const clock = (v: string) => v.slice(0, 5);

function SettingsSection() {
  const { data } = useSuspenseQuery(settingsQuery);
  const save = useServerFn(saveSettings);
  const qc = useQueryClient();
  const [f, setF] = useState({
    sudden_x: Number(data.sudden_x),
    cooldown_min: data.cooldown_min,
    quiet_enabled: data.quiet_enabled,
    quiet_start: clock(data.quiet_start),
    quiet_end: clock(data.quiet_end),
    alert_types: (data.alert_types ?? {}) as Record<string, Record<string, boolean>>,
  });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const on = (t: string, i: string) => f.alert_types?.[t]?.[i] !== false;
  const toggle = (t: string, i: string, v: boolean) =>
    setF({ ...f, alert_types: { ...f.alert_types, [t]: { ...(f.alert_types[t] ?? {}), [i]: v } } });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      await save({ data: f });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Alert settings</h2>
      <form onSubmit={submit} className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="py-2 text-left font-normal">Alert</th>
                {INSTRUMENT_IDS.map((id) => (
                  <th key={id} className="px-2 py-2 font-normal">
                    {id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALERT_TYPES.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-2 pr-2">{t.label}</td>
                  {INSTRUMENT_IDS.map((id) => (
                    <td key={id} className="px-2 py-2 text-center">
                      <Switch
                        aria-label={`${t.label} ${id}`}
                        checked={on(t.id, id)}
                        onCheckedChange={(v) => toggle(t.id, id, v)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">
            Sudden move (× avg hourly range)
            <Input
              className="mt-1"
              type="number"
              step="0.1"
              min={0.1}
              max={20}
              value={f.sudden_x}
              onChange={(e) => setF({ ...f, sudden_x: Number(e.target.value) })}
            />
          </label>
          <label className="text-xs">
            Cooldown (minutes)
            <Input
              className="mt-1"
              type="number"
              min={1}
              max={1440}
              value={f.cooldown_min}
              onChange={(e) => setF({ ...f, cooldown_min: Math.round(Number(e.target.value)) })}
            />
          </label>
          <label className="col-span-2 flex items-center justify-between text-sm">
            Quiet hours (Dubai)
            <Switch
              checked={f.quiet_enabled}
              onCheckedChange={(v) => setF({ ...f, quiet_enabled: v })}
            />
          </label>
          <label className="text-xs">
            From
            <Input
              className="mt-1"
              type="time"
              disabled={!f.quiet_enabled}
              value={f.quiet_start}
              onChange={(e) => setF({ ...f, quiet_start: e.target.value })}
            />
          </label>
          <label className="text-xs">
            To
            <Input
              className="mt-1"
              type="time"
              disabled={!f.quiet_enabled}
              value={f.quiet_end}
              onChange={(e) => setF({ ...f, quiet_end: e.target.value })}
            />
          </label>
        </div>
        <Button size="sm" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
        {msg && (
          <span role="status" className="ml-3 text-xs text-muted-foreground">
            {msg}
          </span>
        )}
      </form>
    </section>
  );
}

function HistorySection() {
  const { data } = useSuspenseQuery(alertsQuery);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Alert history</h2>
      {!data.length ? (
        <Empty
          title="No alerts yet"
          message="Alerts appear here as soon as the engine fires one, whether or not WhatsApp is configured."
        />
      ) : (
        data.map((a) => (
          <article key={a.id} className="border-t border-border py-3">
            <div className="mb-1 flex flex-wrap items-center gap-3 text-xs">
              <span className="num text-muted-foreground">{fmtDubai(a.created_at)}</span>
              <span className="text-primary">
                {a.type}
                {a.instrument ? ` · ${a.instrument}` : ""}
              </span>
              <span
                className={
                  a.status === "sent"
                    ? "text-up"
                    : a.status === "failed"
                      ? "text-down"
                      : "text-muted-foreground"
                }
              >
                {a.status}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{a.message}</p>
            {a.error && <p className="mt-1 text-xs text-down">{a.error}</p>}
          </article>
        ))
      )}
    </section>
  );
}
