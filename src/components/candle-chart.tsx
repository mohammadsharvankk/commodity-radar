import { useEffect, useRef } from "react";
import type { Candle, DayLevels } from "@/lib/engine";
import { fmtDubai } from "@/lib/time";
import { useTheme } from "@/lib/theme";
export default function CandleChart({ candles, levels }: { candles: Candle[]; levels: DayLevels }) {
  const host = useRef<HTMLDivElement>(null);
  const [theme] = useTheme();
  useEffect(() => {
    const element = host.current;
    if (!element || !candles.length) return;
    let disposed = false; let cleanup = () => {};
    void import("lightweight-charts").then(({ createChart, CandlestickSeries, HistogramSeries, LineStyle }) => {
      if (disposed) return;
      const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      // Canvas needs browser-resolved colors, not raw OKLCH strings on older engines.
      const color = (name: string) => { const probe = document.createElement("span"); probe.style.color = token(name); element.append(probe); const resolved = getComputedStyle(probe).color; probe.remove(); return resolved; };
      const up = color("--up"), down = color("--down"), border = color("--border"), muted = color("--muted-foreground");
      const chart = createChart(element, { autoSize: true, height: 400, layout: { background: { color: color("--card") }, textColor: muted, fontFamily: "Inter", fontSize: 10 }, grid: { vertLines: { color: border }, horzLines: { color: border } }, rightPriceScale: { borderColor: border }, timeScale: { borderColor: border, timeVisible: true }, localization: { timeFormatter: (t: unknown) => typeof t === "number" ? fmtDubai(t * 1000) + " Dubai" : String(t) } });
      const series = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down });
      series.setData(candles.map(c => ({ time: c.t / 1000 as import("lightweight-charts").UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
      for (const [label, range] of [["Asia", levels.asia], ["London", levels.london], ["Previous day", levels.prevDay]] as const) {
        if (!range) continue;
        for (const [side, p] of [["H", range.hi], ["L", range.lo]] as const) series.createPriceLine({ price: p, color: label === "Asia" ? color("--primary") : label === "London" ? color("--warn") : muted, lineWidth: 1, lineStyle: LineStyle.Dashed, title: `${label} ${side}` });
      }
      const shading = chart.addSeries(HistogramSeries, { priceScaleId: "session", priceLineVisible: false, lastValueVisible: false });
      chart.priceScale("session").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      const { asiaStart, londonOpen, londonClose, nyOpen, nyClose } = levels.windows;
      shading.setData(candles.map(c => ({ time: c.t / 1000 as import("lightweight-charts").UTCTimestamp, value: 1, color: c.t >= nyOpen && c.t < nyClose ? token("--session-ny") : c.t >= londonOpen && c.t < londonClose ? token("--session-london") : c.t >= asiaStart && c.t < londonOpen ? token("--session-asia") : "transparent" })));
      chart.timeScale().fitContent(); cleanup = () => chart.remove();
    });
    return () => { disposed = true; cleanup(); };
  }, [candles, levels, theme]);
  return <div ref={host} className="h-[400px] min-w-0 w-full" aria-label="Candlestick chart with session levels" />;
}