import { describe, expect, it } from "vitest";

import type { AccountStatus, Platform } from "@/lib/adapters/types";
import {
  DELTA_NOTES,
  DELTA_PLACEHOLDER,
  GATED_METRICS_THRESHOLD,
  SPARKLINE_POINTS,
  buildDashboardMetrics,
  gatedMetricsNotice,
  type DashboardAccount,
  type SnapshotPoint,
} from "@/lib/dashboard/metrics";

const BASE_DAY = Date.UTC(2026, 8, 1);

function day(offset: number): string {
  return new Date(BASE_DAY + offset * 86_400_000).toISOString().slice(0, 10);
}

function snap(capturedOn: string, audienceCount: number): SnapshotPoint {
  return { capturedOn, audienceCount };
}

function series(counts: readonly number[]): SnapshotPoint[] {
  return counts.map((audienceCount, offset) => snap(day(offset), audienceCount));
}

function account(
  id: string,
  platform: Platform,
  snapshots: readonly SnapshotPoint[],
  status: AccountStatus = "active",
): DashboardAccount {
  return { id, platform, handle: `@${id}`, status, snapshots };
}

describe("buildDashboardMetrics", () => {
  it("sums the latest audience of every account", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([1200, 1250, 1300])),
      account("tt-1", "tiktok", series([800, 900])),
      account("ig-1", "instagram", [snap(day(0), 45)]),
    ]);

    expect(metrics.combinedAudience).toBe(1300 + 900 + 45);
  });

  it("counts an account with no snapshots as nothing, not as zero followers", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([500])),
      account("fb-1", "facebook", []),
    ]);

    expect(metrics.combinedAudience).toBe(500);
    expect(metrics.rows[1]?.audienceCount).toBeNull();
  });

  it("labels the combined total as a count, not unique people", () => {
    const metrics = buildDashboardMetrics([]);

    expect(metrics.combinedAudienceLabel).toBe("Total audience across platforms");
    expect(metrics.combinedAudienceNote).toBe(
      "Same person can follow you on more than one platform — this is a count, not unique people.",
    );
  });

  it("computes the 7-day delta once exactly 8 days of history exist", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([100, 110, 120, 130, 140, 150, 160, 250])),
    ]);

    expect(metrics.rows[0]?.delta).toEqual({
      available: true,
      value: 150,
      from: day(0),
      to: day(7),
    });
  });

  it("reports a gap instead of interpolating when nothing was captured 7 days back", () => {
    const captured = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10];
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", captured.map((offset) => snap(day(offset), 100 + offset))),
    ]);

    expect(metrics.rows[0]?.delta).toEqual({ available: false, reason: "gap" });
    expect(DELTA_NOTES.gap).toContain("7 days ago");
  });

  it("reports building history when the account has fewer than 8 days", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([100, 105, 110, 115])),
      account("tt-1", "tiktok", [snap(day(0), 10)]),
    ]);

    expect(metrics.rows[0]?.delta).toEqual({ available: false, reason: "building_history" });
    expect(metrics.rows[1]?.delta).toEqual({ available: false, reason: "building_history" });
    expect(DELTA_PLACEHOLDER).toBe("—");
  });

  it("reports no data for an account that has never been snapshotted", () => {
    const metrics = buildDashboardMetrics([account("ig-1", "instagram", [])]);

    expect(metrics.rows[0]?.delta).toEqual({ available: false, reason: "no_data" });
    expect(metrics.rows[0]?.lastUpdated).toBeNull();
    expect(metrics.rows[0]?.sparkline).toEqual([]);
  });

  it("orders snapshots before computing, so input order does not matter", () => {
    const shuffled = [snap(day(7), 250), snap(day(0), 100), snap(day(3), 175)];
    const metrics = buildDashboardMetrics([account("yt-1", "youtube", shuffled)]);

    expect(metrics.rows[0]?.audienceCount).toBe(250);
    expect(metrics.rows[0]?.delta).toEqual({
      available: true,
      value: 150,
      from: day(0),
      to: day(7),
    });
    expect(metrics.rows[0]?.sparkline.map((point) => point.capturedOn)).toEqual([
      day(0),
      day(3),
      day(7),
    ]);
  });

  it("keeps the sparkline to the most recent 30 snapshots, oldest first", () => {
    const metrics = buildDashboardMetrics([
      account(
        "yt-1",
        "youtube",
        Array.from({ length: 35 }, (_, offset) => snap(day(offset), 1000 + offset)),
      ),
    ]);

    const sparkline = metrics.rows[0]?.sparkline ?? [];

    expect(sparkline).toHaveLength(SPARKLINE_POINTS);
    expect(sparkline[0]).toEqual({ capturedOn: day(5), audienceCount: 1005 });
    expect(sparkline.at(-1)).toEqual({ capturedOn: day(34), audienceCount: 1034 });
    expect(sparkline.map((point) => point.capturedOn)).toEqual(
      [...sparkline.map((point) => point.capturedOn)].sort(),
    );
  });

  it("leaves holes in the sparkline rather than filling missing days", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", [snap(day(0), 100), snap(day(2), 120)]),
    ]);

    expect(metrics.rows[0]?.sparkline).toEqual([
      { capturedOn: day(0), audienceCount: 100 },
      { capturedOn: day(2), audienceCount: 120 },
    ]);
  });

  it("keeps each platform's delta independent", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([100, 110, 120, 130, 140, 150, 160, 250])),
      account("tt-1", "tiktok", series([10, 12])),
    ]);

    expect(metrics.rows[0]?.delta).toMatchObject({ available: true, value: 150 });
    expect(metrics.rows[1]?.delta).toEqual({ available: false, reason: "building_history" });
  });

  it("withholds the combined delta unless every account can compute one", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([100, 110, 120, 130, 140, 150, 160, 250])),
      account("tt-1", "tiktok", series([10, 12])),
    ]);

    expect(metrics.delta).toEqual({ available: false, reason: "building_history" });
  });

  it("reports a gap for the combined delta when every account is blocked by one", () => {
    const captured = [0, 1, 2, 4, 5, 6, 7, 8, 9, 10];
    const blocked = captured.map((offset) => snap(day(offset), 100 + offset));

    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", blocked),
      account("ig-1", "instagram", blocked),
    ]);

    expect(metrics.delta).toEqual({ available: false, reason: "gap" });
  });

  it("sums the combined delta when every account has one", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([100, 110, 120, 130, 140, 150, 160, 250])),
      account("tt-1", "tiktok", series([10, 12, 14, 16, 18, 20, 22, 40])),
    ]);

    expect(metrics.delta).toEqual({
      available: true,
      value: 150 + 30,
      from: day(0),
      to: day(7),
    });
  });

  it("reports no data for the combined delta when there are no accounts", () => {
    expect(buildDashboardMetrics([]).delta).toEqual({ available: false, reason: "no_data" });
  });

  it("orders rows by platform", () => {
    const metrics = buildDashboardMetrics([
      account("fb-1", "facebook", []),
      account("tt-1", "tiktok", []),
      account("yt-1", "youtube", []),
      account("ig-1", "instagram", []),
    ]);

    expect(metrics.rows.map((row) => row.platform)).toEqual([
      "youtube",
      "tiktok",
      "instagram",
      "facebook",
    ]);
  });

  it("exposes the account identity and the latest snapshot date for each row", () => {
    const metrics = buildDashboardMetrics([
      {
        id: "yt-1",
        platform: "youtube",
        handle: "@qwert",
        avatarUrl: "https://yt3.ggpht.com/yt-1.jpg",
        status: "active",
        snapshots: series([100, 110]),
      },
    ]);

    expect(metrics.rows[0]).toMatchObject({
      id: "yt-1",
      platform: "youtube",
      handle: "@qwert",
      avatarUrl: "https://yt3.ggpht.com/yt-1.jpg",
      audienceCount: 110,
      lastUpdated: day(1),
    });
  });

  it("falls back to a null avatar rather than undefined", () => {
    const metrics = buildDashboardMetrics([account("yt-1", "youtube", [])]);

    expect(metrics.rows[0]?.avatarUrl).toBeNull();
  });

  it("rejects a malformed snapshot date", () => {
    expect(() =>
      buildDashboardMetrics([account("yt-1", "youtube", [snap("not-a-date", 10)])]),
    ).toThrow(/Invalid snapshot date: not-a-date/);
  });

  it("surfaces each account's connection status on its row", () => {
    const metrics = buildDashboardMetrics([
      account("yt-1", "youtube", series([100, 110]), "needs_reconnect"),
      account("tt-1", "tiktok", series([10, 12]), "revoked"),
      account("ig-1", "instagram", series([5, 6])),
    ]);

    expect(metrics.rows.map((row) => row.status)).toEqual([
      "needs_reconnect",
      "revoked",
      "active",
    ]);
  });

  it("notes the withheld insight metrics while an account sits under the gate", () => {
    const metrics = buildDashboardMetrics([
      account("ig-1", "instagram", [snap(day(0), GATED_METRICS_THRESHOLD - 1)]),
      account("fb-1", "facebook", [snap(day(0), GATED_METRICS_THRESHOLD - 1)]),
    ]);

    expect(metrics.rows[0]?.gatedNotice).toBe(
      `Reach and impressions aren't collected yet (and are hidden below ${GATED_METRICS_THRESHOLD} followers) — showing your audience count only.`,
    );
    expect(metrics.rows[1]?.gatedNotice).toBe(
      `Page insights aren't collected yet (and are hidden below ${GATED_METRICS_THRESHOLD} Page likes) — showing your audience count only.`,
    );
    expect(metrics.rows[0]?.audienceCount).toBe(GATED_METRICS_THRESHOLD - 1);
  });

  it("drops the gate note once the account clears the threshold", () => {
    expect(gatedMetricsNotice("instagram", GATED_METRICS_THRESHOLD)).toBeNull();
    expect(gatedMetricsNotice("facebook", GATED_METRICS_THRESHOLD + 1)).toBeNull();
  });

  it("never claims a gate on platforms that do not withhold these metrics", () => {
    expect(gatedMetricsNotice("youtube", 10)).toBeNull();
    expect(gatedMetricsNotice("tiktok", 10)).toBeNull();
  });

  it("stays quiet about gating for an account with no snapshot yet", () => {
    const metrics = buildDashboardMetrics([account("ig-1", "instagram", [])]);

    expect(metrics.rows[0]?.gatedNotice).toBeNull();
    expect(metrics.rows[0]?.audienceCount).toBeNull();
  });
});
