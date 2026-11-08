import { useEffect, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Minus, RefreshCw } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { fmtDubai } from "@/lib/time";
import { INSTRUMENTS } from "@/lib/instruments";
import type { Trend } from "@/lib/engine";

export function useClock(initial = 0) {
  const [now, setNow] = useState(initial);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  return now;
}
export function PageTitle({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs text-primary"><Activity className="size-3.5" /> PERSONAL MARKET INTELLIGENCE</div><h1 className="text-2xl font-semibold md:text-3xl">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{subtitle}</p></div>{children}</div>;
}
export function RefreshButton() {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  return <Button variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await router.invalidate({ sync: true }); } finally { setBusy(false); } }}><RefreshCw className={busy ? "animate-spin" : ""} />Refresh</Button>;
}
export function Empty({ title, message }: { title: string; message: string }) {
  return <div className="border-y border-border py-12 text-center"><Activity className="mx-auto mb-3 size-7 text-muted-foreground" /><h2 className="font-medium">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{message}</p></div>;
}
export function LoadError({ error }: { error: unknown }) {
  return <div className="py-12"><h1 className="text-xl">Unable to load market data</h1><p role="alert" className="my-4 text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p><RefreshButton /></div>;
}
export function TrendMark({ trend }: { trend: Trend }) {
  return <span className={`inline-flex items-center gap-1 num text-xs ${trend === "up" ? "text-up" : trend === "down" ? "text-down" : "text-muted-foreground"}`}>{trend === "up" ? <ArrowUpRight className="size-4" /> : trend === "down" ? <ArrowDownRight className="size-4" /> : <Minus className="size-4" />}{trend === "n/a" ? "—" : trend === "sideways" ? "FLAT" : trend.toUpperCase()}</span>;
}
export function InstrumentFilter({ value, onChange, all = false }: { value: string; onChange: (id: string) => void; all?: boolean }) {
  return <div className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1" role="group" aria-label="Instrument">{(all ? [{ id: "ALL", short: "All" }, ...INSTRUMENTS] : INSTRUMENTS).map(i => <Button key={i.id} size="sm" variant={value === i.id ? "secondary" : "ghost"} aria-pressed={value === i.id} onClick={() => onChange(i.id)}>{i.short}</Button>)}</div>;
}
export function Timestamp({ ts }: { ts: string | number }) { return <span className="num text-xs text-muted-foreground">{fmtDubai(ts)} Dubai</span>; }
export function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return <div className="flex h-24 items-center justify-center border-b border-dashed border-border text-xs text-muted-foreground">Awaiting price history</div>;
  const lo = Math.min(...values), hi = Math.max(...values), range = hi - lo || 1;
  const points = values.map((v, i) => `${i / (values.length - 1) * 400},${88 - (v - lo) / range * 76}`).join(" ");
  return <svg viewBox="0 0 400 100" preserveAspectRatio="none" role="img" aria-label="Recent price history" className={`h-24 w-full ${positive ? "text-up" : "text-down"}`}><path d="M0 98H400" stroke="var(--border)" /><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}
export { ArrowRight };