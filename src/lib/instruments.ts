export type InstrumentId = "WTI" | "SILVER" | "GOLD";

export interface Instrument {
  id: InstrumentId;
  name: string;
  short: string;
  symbol: string;
  emoji: string;
  decimals: number;
}

// Priority order: WTI always first. Gold is switched off (rarely traded); set
// active: true to bring it back everywhere (dashboard, polling, alerts, stats).
export const ALL_INSTRUMENTS: (Instrument & { active: boolean })[] = [
  {
    id: "WTI",
    name: "WTI Crude Oil",
    short: "WTI",
    symbol: "CL=F",
    emoji: "🛢",
    decimals: 2,
    active: true,
  },
  {
    id: "SILVER",
    name: "Silver",
    short: "Silver",
    symbol: "SI=F",
    emoji: "🥈",
    decimals: 3,
    active: true,
  },
  {
    id: "GOLD",
    name: "Gold",
    short: "Gold",
    symbol: "GC=F",
    emoji: "🥇",
    decimals: 1,
    active: false,
  },
];
export const INSTRUMENTS: Instrument[] = ALL_INSTRUMENTS.filter((i) => i.active);

export const INSTRUMENT_IDS: InstrumentId[] = INSTRUMENTS.map((i) => i.id);

export function getInstrument(id: string): Instrument | undefined {
  return ALL_INSTRUMENTS.find((i) => i.id === id);
}

export const ALERT_TYPES = [
  { id: "briefing", label: "Pre-window briefing (30 min before)" },
  { id: "approach", label: "Price approaching a key level" },
  { id: "recap", label: "End-of-window recap" },
  { id: "headsup", label: "Session heads-up at NY open" },
  { id: "structure", label: "Liquidity sweep / break of structure at session opens" },
  { id: "sudden", label: "Sudden move" },
  { id: "prereport", label: "30-min pre-report reminder" },
  { id: "postreport", label: "Post-report reaction summary" },
  { id: "news", label: "Strong news (impact ≥ 4)" },
  { id: "biasflip", label: "Bias flip" },
  { id: "eiasetup", label: "EIA Wednesday setup (big pre-report move)" },
] as const;
export type AlertTypeId = (typeof ALERT_TYPES)[number]["id"];

export const DUBAI_TZ = "Asia/Dubai";
export const NY_TZ = "America/New_York";
export const LDN_TZ = "Europe/London";
