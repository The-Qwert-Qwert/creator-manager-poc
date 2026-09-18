import { describe, expect, it } from "vitest";

import {
  MANUAL_REFRESH_COOLDOWN_MS,
  cooldownLabel,
  cooldownRemainingMs,
} from "@/lib/dashboard/manual-refresh";

const NOW = new Date("2026-09-18T12:00:00Z");

describe("cooldownRemainingMs", () => {
  it("allows a refresh for an account that has never been refreshed manually", () => {
    expect(cooldownRemainingMs(null, NOW)).toBe(0);
    expect(cooldownRemainingMs(undefined, NOW)).toBe(0);
  });

  it("blocks a second refresh inside the hour", () => {
    const tenMinutesAgo = new Date(NOW.getTime() - 10 * 60_000);

    expect(cooldownRemainingMs(tenMinutesAgo, NOW)).toBe(
      MANUAL_REFRESH_COOLDOWN_MS - 10 * 60_000,
    );
  });

  it("accepts the timestamp in the shape the database returns it", () => {
    expect(cooldownRemainingMs("2026-09-18T11:30:00+00:00", NOW)).toBe(30 * 60_000);
  });

  it("allows the refresh as soon as the hour is up", () => {
    const anHourAgo = new Date(NOW.getTime() - MANUAL_REFRESH_COOLDOWN_MS);

    expect(cooldownRemainingMs(anHourAgo, NOW)).toBe(0);
  });

  it("never reports a negative wait for an older refresh", () => {
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60_000);

    expect(cooldownRemainingMs(yesterday, NOW)).toBe(0);
  });

  it("treats an unparseable timestamp as no cooldown rather than locking the account out", () => {
    expect(cooldownRemainingMs("not-a-date", NOW)).toBe(0);
  });
});

describe("cooldownLabel", () => {
  it("rounds a partial minute up so the button never promises a wait that already passed", () => {
    expect(cooldownLabel(30 * 60_000)).toBe("Available in 30 min");
    expect(cooldownLabel(60_001)).toBe("Available in 2 min");
    expect(cooldownLabel(1)).toBe("Available in 1 min");
  });
});
