import { fmtCountdown, fmtDubaiTime } from "@/lib/time";
import { MAX_ALERTS_PER_WINDOW, nextWindow, windowState } from "@/lib/window";
import { useClock } from "./radar-common";

/** Shows today's trading window and whether the app is live or resting. */
export function WindowBanner() {
  const now = useClock();
  if (!now) return null;
  const { phase, win } = windowState(now);
  const next = nextWindow(now);
  const live = phase === "in" && win;
  const w = live ? win : next;
  if (!w) return null;
  return (
    <div
      className={`panel mb-5 flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${live ? "border-up/40" : ""}`}
    >
      <span className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${live ? "bg-up" : "bg-muted-foreground/40"}`} />
        <span className="font-medium">{live ? "Trading window live" : "Resting"}</span>
        <span className="text-muted-foreground">
          {fmtDubaiTime(w.start)}–{fmtDubaiTime(w.end)} Dubai
        </span>
      </span>
      <span className="text-xs text-muted-foreground">
        {live
          ? `ends in ${fmtCountdown(w.end - now)} · max ${MAX_ALERTS_PER_WINDOW} alerts`
          : `starts in ${fmtCountdown(w.start - now)} · briefing 30 min before`}
      </span>
    </div>
  );
}
