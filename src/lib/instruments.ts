export type InstrumentId = "WTI" | "SILVER" | "GOLD";

export interface Instrument {
  id: InstrumentId;
  name: string;
  short: string;
  symbol: string;
  emoji: string;
  decimals: number;
}

// Priority order: WTI always first.
export const INSTRUMENTS: Instrument[] = [
  { id: "WTI", name: "WTI Crude Oil", short: "WTI", symbol: "CL=F", emoji: "🛢", decimals: 2 },
  { id: "SILVER", name: "Silver", short: "Silver", symbol: "SI=F", emoji: "🥈", decimals: 3 },
  { id: "GOLD", name: "Gold", short: "Gold", symbol: "GC=F", emoji: "🥇", decimals: 1 },
];

export const INSTRUMENT_IDS: InstrumentId[] = INSTRUMENTS.map((i) => i.id);

export function getInstrument(id: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

export const ALERT_TYPES = [
  { id: "headsup", label: "Session heads-up at NY open" },
  { id: "structure", label: "Liquidity sweep / break of structure at session opens" },
  { id: "sudden", label: "Sudden move" },
  { id: "prereport", label: "30-min pre-report reminder" },
  { id: "postreport", label: "Post-report reaction summary" },
  { id: "news", label: "Strong news (impact ≥ 4)" },
  { id: "biasflip", label: "Bias flip" },
] as const;
export type AlertTypeId = (typeof ALERT_TYPES)[number]["id"];

export const DUBAI_TZ = "Asia/Dubai";
export const NY_TZ = "America/New_York";
export const LDN_TZ = "Europe/London";
