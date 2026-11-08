export function radarHead(page: string, description: string) {
  const title = `Commodity Radar — ${page}`;
  return { meta: [{ title }, { name: "description", content: description }, { property: "og:title", content: title }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] };
}
export function price(value: number | null | undefined, decimals = 2) {
  return value == null ? "—" : value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function percent(value: number | null | undefined, decimals = 2) {
  return value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}