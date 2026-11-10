import { describe, expect, it } from "vitest";
import { keywordTag } from "@/lib/jobs.server";

describe("keyword sentiment fallback", () => {
  it("supply boost is bearish for oil", () => {
    const t = keywordTag("Iraq Strikes U.S. Deal to Boost Oil Exports Through Hormuz");
    expect(t.instruments).toContain("WTI");
    expect(t.sentiment.WTI).toBe("bearish");
  });
  it("attack on tanker is bullish for oil", () => {
    expect(keywordTag("Drone attack disrupts crude loadings at Saudi terminal").sentiment.WTI).toBe(
      "bullish",
    );
  });
  it("dovish Fed is bullish for silver", () => {
    expect(keywordTag("Silver climbs as Fed signals rate cut").sentiment.SILVER).toBe("bullish");
  });
  it("irrelevant headline tags nothing", () => {
    expect(keywordTag("Apple unveils new iPhone").instruments).toEqual([]);
  });
});
