import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Bell, CalendarDays, ChartNoAxesCombined, LayoutDashboard, LogOut, Newspaper, Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useClock } from "./radar-common";
import { currentSession, fmtDubaiTime, isMarketOpen } from "@/lib/time";

const tabs = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/patterns", label: "Patterns", icon: ChartNoAxesCombined },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/alerts", label: "Alerts", icon: Bell },
] as const;
export function RadarShell({ children }: { children: React.ReactNode }) {
  const now = useClock(); const queryClient = useQueryClient(); const navigate = useNavigate();
  async function signOut() { await queryClient.cancelQueries(); queryClient.clear(); await supabase.auth.signOut(); await navigate({ to: "/auth", replace: true }); }
  return <div className="min-h-screen bg-background"><header className="border-b border-border bg-surface"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 md:px-8"><Link to="/dashboard" className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-md border border-primary/30 text-primary"><Radar className="size-6" /></span><div className="font-semibold">COMMODITY <span className="text-primary">RADAR</span><div className="mt-0.5 text-[10px] font-normal text-muted-foreground">WTI / SILVER / GOLD</div></div></Link><div className="flex items-center gap-4"><div className="hidden text-right sm:block"><div className="num text-sm">{now ? fmtDubaiTime(now) : "—"} <span className="text-xs text-muted-foreground">DUBAI</span></div><div className="text-xs text-muted-foreground">UTC +4</div></div><Button variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut /></Button></div></div></header><nav className="hidden border-b border-border md:block"><div className="mx-auto flex max-w-7xl px-8">{tabs.map(t => <Button asChild key={t.to} variant="ghost" className="h-12 rounded-none px-5"><Link to={t.to} activeProps={{ className: "text-primary border-b-2 border-primary bg-primary/5" }}><t.icon />{t.label}</Link></Button>)}</div></nav><div className="border-b border-border bg-surface/50"><div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-2 text-xs md:px-8"><span className="flex items-center gap-2"><Activity className={`size-3.5 ${now && isMarketOpen(now) ? "text-up" : "text-muted-foreground"}`} />{now ? currentSession(now) : "Checking session"}</span><span className="text-muted-foreground">All times Dubai · Delayed futures</span></div></div><main className="mx-auto max-w-7xl px-4 pb-28 pt-6 md:px-8 md:pb-10 md:pt-8">{children}<footer className="mt-10 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">Probabilistic heads-up, not financial advice. Yahoo futures are not Plus500 CFD execution prices. Data may be delayed by 10–15 minutes.</footer></main><nav aria-label="Main navigation" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">{tabs.map(t => <Button asChild key={t.to} variant="ghost" className="h-16 min-w-0 flex-col gap-1 rounded-none px-0 text-[10px]"><Link to={t.to} activeProps={{ className: "text-primary bg-primary/5 border-t-2 border-primary" }}><t.icon />{t.label}</Link></Button>)}</nav></div>;
}