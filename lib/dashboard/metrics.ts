import { PLATFORMS, type AccountStatus, type Platform } from "@/lib/adapters/types";

export const DELTA_WINDOW_DAYS = 7;
export const SPARKLINE_POINTS = 30;
// Enough history for the sparkline plus slack for the 7-day delta, so the newest
// snapshot is always present even if it is older than the sparkline window.
export const SNAPSHOT_FETCH_LIMIT = SPARKLINE_POINTS + 30;

export const COMBINED_AUDIENCE_LABEL = "Total audience across platforms";
export const COMBINED_AUDIENCE_NOTE =
  "Same person can follow you on more than one platform — this is a count, not unique people.";
export const DELTA_PLACEHOLDER = "—";

export type DeltaReason = "no_data" | "building_history" | "gap";

export const DELTA_NOTES: Record<DeltaReason, string> = {
  no_data: "No snapshots yet",
  building_history: "Building history",
  gap: `No snapshot ${DELTA_WINDOW_DAYS} days ago`,
};

export const GATED_METRICS_THRESHOLD = 100;

/** FSD §9.3/§9.4: the insight metrics each platform withholds below the gate. */
const GATED_METRICS: Partial<Record<Platform, { hidden: string; thresholdUnit: string }>> = {
  instagram: { hidden: "Reach and impressions", thresholdUnit: "followers" },
  facebook: { hidden: "Page insights", thresholdUnit: "Page likes" },
};

/**
 * FR-7: when a platform withholds a metric, show the numbers we do have plus a
 * plain-language note — never an empty widget.
 */
export function gatedMetricsNotice(
  platform: Platform,
  audienceCount: number | null,
): string | null {
  const gate = GATED_METRICS[platform];

  if (!gate || audienceCount === null || audienceCount >= GATED_METRICS_THRESHOLD) {
    return null;
  }

  return `${gate.hidden} aren't collected yet (and are hidden below ${GATED_METRICS_THRESHOLD} ${gate.thresholdUnit}) — showing your audience count only.`;
}

export type Delta =
  | { available: true; value: number; from: string; to: string }
  | { available: false; reason: DeltaReason };

type DeltaAvailable = Extract<Delta, { available: true }>;
type DeltaUnavailable = Extract<Delta, { available: false }>;

export interface SnapshotPoint {
  capturedOn: string;
  audienceCount: number;
}

export interface DashboardAccount {
  id: string;
  platform: Platform;
  handle: string;
  avatarUrl?: string | null;
  status: AccountStatus;
  snapshots: readonly SnapshotPoint[];
}

export interface DashboardRow {
  id: string;
  platform: Platform;
  handle: string;
  avatarUrl: string | null;
  status: AccountStatus;
  audienceCount: number | null;
  delta: Delta;
  lastUpdated: string | null;
  sparkline: SnapshotPoint[];
  gatedNotice: string | null;
}

export interface DashboardMetrics {
  combinedAudience: number;
  combinedAudienceLabel: string;
  combinedAudienceNote: string;
  delta: Delta;
  rows: DashboardRow[];
}

interface DatedSnapshot extends SnapshotPoint {
  day: number;
}

const MS_PER_DAY = 86_400_000;
const REASON_PRECEDENCE: readonly DeltaReason[] = ["no_data", "building_history", "gap"];

function toEpochDay(capturedOn: string): number {
  const parsed = Date.parse(`${capturedOn.slice(0, 10)}T00:00:00Z`);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid snapshot date: ${capturedOn}`);
  }

  return Math.floor(parsed / MS_PER_DAY);
}

function prepare(snapshots: readonly SnapshotPoint[]): DatedSnapshot[] {
  return snapshots
    .map((snapshot) => ({ ...snapshot, day: toEpochDay(snapshot.capturedOn) }))
    .sort((a, b) => a.day - b.day);
}

function accountDelta(sorted: readonly DatedSnapshot[]): Delta {
  const latest = sorted.at(-1);
  const earliest = sorted[0];

  if (!latest || !earliest) {
    return { available: false, reason: "no_data" };
  }

  const targetDay = latest.day - DELTA_WINDOW_DAYS;
  const target = sorted.find((snapshot) => snapshot.day === targetDay);

  if (target) {
    return {
      available: true,
      value: latest.audienceCount - target.audienceCount,
      from: target.capturedOn,
      to: latest.capturedOn,
    };
  }

  // ponytail: exact-match only. A gap at the 7-day mark reports unavailable
  // rather than reaching for the nearest snapshot, which would silently widen
  // the window the "vs 7 days ago" label promises. Upgrade path: nearest
  // at-or-before, once the UI can display the real span it used.
  return {
    available: false,
    reason: earliest.day > targetDay ? "building_history" : "gap",
  };
}

function isUnavailable(delta: Delta): delta is DeltaUnavailable {
  return !delta.available;
}

function combineDeltas(deltas: readonly Delta[]): Delta {
  const available = deltas.filter((delta): delta is DeltaAvailable => delta.available);

  if (available.length !== deltas.length) {
    const blocked = deltas.filter(isUnavailable);
    const reason = REASON_PRECEDENCE.find((candidate) =>
      blocked.some((delta) => delta.reason === candidate),
    );

    return { available: false, reason: reason ?? "gap" };
  }

  const [first, ...rest] = available;

  if (!first) {
    return { available: false, reason: "no_data" };
  }

  let value = first.value;
  let from = first.from;
  let to = first.to;

  // ponytail: a platform whose last snapshot is a day older widens the
  // reported window by that day. Each account's own delta is still exactly
  // DELTA_WINDOW_DAYS long. Upgrade path: anchor every account to one shared
  // reference date once missed cron runs are backfilled.
  for (const delta of rest) {
    value += delta.value;
    from = delta.from < from ? delta.from : from;
    to = delta.to > to ? delta.to : to;
  }

  return { available: true, value, from, to };
}

function toRow(account: DashboardAccount): DashboardRow {
  const sorted = prepare(account.snapshots);
  const latest = sorted.at(-1);

  return {
    id: account.id,
    platform: account.platform,
    handle: account.handle,
    avatarUrl: account.avatarUrl ?? null,
    status: account.status,
    audienceCount: latest?.audienceCount ?? null,
    delta: accountDelta(sorted),
    lastUpdated: latest?.capturedOn ?? null,
    sparkline: sorted
      .slice(-SPARKLINE_POINTS)
      .map(({ capturedOn, audienceCount }) => ({ capturedOn, audienceCount })),
    gatedNotice: gatedMetricsNotice(account.platform, latest?.audienceCount ?? null),
  };
}

export function buildDashboardMetrics(accounts: readonly DashboardAccount[]): DashboardMetrics {
  const rows = accounts
    .map(toRow)
    .sort(
      (a, b) =>
        PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) ||
        a.handle.localeCompare(b.handle),
    );

  return {
    combinedAudience: rows.reduce((total, row) => total + (row.audienceCount ?? 0), 0),
    combinedAudienceLabel: COMBINED_AUDIENCE_LABEL,
    combinedAudienceNote: COMBINED_AUDIENCE_NOTE,
    delta: combineDeltas(rows.map((row) => row.delta)),
    rows,
  };
}
