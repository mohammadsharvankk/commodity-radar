import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  LayoutDashboard,
  LogOut,
  Moon,
  Newspaper,
  Sun,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useClock } from "./radar-common";
import { currentSession, fmtDubaiTime, isMarketOpen } from "@/lib/time";
import { useTheme } from "@/lib/theme";

const tabs = [
  { to: "/dashboard", label: "Markets", icon: LayoutDashboard },
  { to: "/patterns", label: "Patterns", icon: ChartNoAxesCombined },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/news", label: "News", icon: Newspaper },
  { to: "/alerts", label: "Alerts", icon: Bell },
] as const;

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
      <span className="text-[17px] font-semibold tracking-tight">Stock Radar</span>
      <span className="text-xs text-muted-foreground">by Sharvan</span>
    </span>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

export function RadarShell({ children }: { children: React.ReactNode }) {
  const now = useClock();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }
  const open = !!now && isMarketOpen(now);
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 md:px-8">
          <Link to="/dashboard">
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-1 md:flex">
            {tabs.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
                activeProps={{ className: "bg-secondary !text-foreground font-medium" }}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <span className="mr-2 hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span
                className={`size-1.5 rounded-full ${open ? "bg-up" : "bg-muted-foreground/50"}`}
              />
              {now ? `${currentSession(now)} · ${fmtDubaiTime(now)}` : ""}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              title="Sign out"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut />
            </Button>
          </div>
        </div>
      </header>
      <div className="border-b border-border bg-surface px-4 py-1.5 text-xs text-muted-foreground sm:hidden">
        <span className="inline-flex items-center gap-2">
          <span className={`size-1.5 rounded-full ${open ? "bg-up" : "bg-muted-foreground/50"}`} />
          {now ? `${currentSession(now)} · ${fmtDubaiTime(now)} Dubai` : " "}
        </span>
      </div>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">
        {children}
        <footer className="mt-12 border-t border-border pt-4 text-xs text-muted-foreground">
          Prices are delayed futures quotes (not Plus500 CFD prices). Heads-ups are probabilities,
          not advice.
        </footer>
      </main>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className="flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground"
            activeProps={{ className: "!text-primary font-medium" }}
          >
            <t.icon className="size-5" />
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
