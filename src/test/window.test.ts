import { describe, expect, it } from "vitest";
import { windowState, nextWindow } from "@/lib/window";
import { zonedToUtc } from "@/lib/time";

const dubai = (y: number, m: number, d: number, h: number, mi = 0) =>
  zonedToUtc(y, m, d, h, mi, "Asia/Dubai");

describe("trading window (winter)", () => {
  it("Tuesday 18:00–21:00 Dubai", () => {
    expect(windowState(dubai(2026, 11, 10, 17, 30)).phase).toBe("pre");
    expect(windowState(dubai(2026, 11, 10, 18, 0)).phase).toBe("in");
    expect(windowState(dubai(2026, 11, 10, 20, 55)).phase).toBe("in");
    expect(windowState(dubai(2026, 11, 10, 21, 5)).phase).toBe("post");
    expect(windowState(dubai(2026, 11, 10, 12, 0)).phase).toBe("off");
  });
  it("Wednesday 17:00–20:00 Dubai (EIA at 19:30)", () => {
    expect(windowState(dubai(2026, 11, 11, 16, 35)).phase).toBe("pre");
    expect(windowState(dubai(2026, 11, 11, 17, 0)).phase).toBe("in");
    expect(windowState(dubai(2026, 11, 11, 19, 30)).phase).toBe("in");
    expect(windowState(dubai(2026, 11, 11, 20, 10)).phase).toBe("post");
  });
  it("weekend is off and next window is Monday 18:00 Dubai", () => {
    const sat = dubai(2026, 11, 14, 19, 0);
    expect(windowState(sat).phase).toBe("off");
    expect(new Date(nextWindow(sat)!.start).toISOString()).toBe(
      new Date(dubai(2026, 11, 16, 18, 0)).toISOString(),
    );
  });
  it("summer (US daylight saving) shifts one hour earlier in Dubai", () => {
    expect(windowState(dubai(2027, 6, 15, 17, 0)).phase).toBe("in");
    expect(windowState(dubai(2027, 6, 15, 20, 5)).phase).toBe("post");
  });
});
