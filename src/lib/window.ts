import { NY_TZ } from "./instruments";
import { tzParts, zonedToUtc } from "./time";

/**
 * Sharvan's trading window. Anchored to the New York clock so it follows US daylight
 * saving automatically. In winter (Dubai = NY + 9h):
 *   Mon, Tue, Thu, Fri  09:00–12:00 NY = 18:00–21:00 Dubai
 *   Wednesday           08:00–11:00 NY = 17:00–20:00 Dubai (covers the 10:30 NY EIA report)
 * Outside the window the app is silent: no price polling and no alerts.
 */
export const MAX_ALERTS_PER_WINDOW = 10;
export const BRIEFING_LEAD_MIN = 30;
const LEN_H = 3;

export interface TradingWindow {
  date: string; // NY date key yyyy-mm-dd
  start: number;
  end: number;
}

export type WindowPhase = "pre" | "in" | "post" | "off";

export function windowForNyDay(y: number, m: number, d: number, wd: number): TradingWindow | null {
  if (wd === 0 || wd === 6) return null;
  const startH = wd === 3 ? 8 : 9;
  const start = zonedToUtc(y, m, d, startH, 0, NY_TZ);
  return {
    date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    start,
    end: start + LEN_H * 3600_000,
  };
}

export function todaysWindow(now: number): TradingWindow | null {
  const p = tzParts(now, NY_TZ);
  return windowForNyDay(p.y, p.m, p.d, p.wd);
}

export function windowState(now: number): { phase: WindowPhase; win: TradingWindow | null } {
  const win = todaysWindow(now);
  if (!win) return { phase: "off", win: null };
  if (now >= win.start - BRIEFING_LEAD_MIN * 60_000 - 5 * 60_000 && now < win.start)
    return { phase: "pre", win };
  if (now >= win.start && now < win.end) return { phase: "in", win };
  if (now >= win.end && now < win.end + 25 * 60_000) return { phase: "post", win };
  return { phase: "off", win };
}

/** Next window starting at or after `now` (for countdowns in the UI). */
export function nextWindow(now: number): TradingWindow | null {
  for (let i = 0; i < 8; i++) {
    const p = tzParts(now + i * 86400_000, NY_TZ);
    const w = windowForNyDay(p.y, p.m, p.d, p.wd);
    if (w && w.end > now) return w;
  }
  return null;
}
