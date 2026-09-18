import type { CSSProperties } from "react";

import type { SnapshotPoint } from "@/lib/dashboard/metrics";

const WIDTH = 120;
const HEIGHT = 32;
const PADDING = 3;

interface SparklineProps {
  points: readonly SnapshotPoint[];
  platformLabel: string;
}

/** FSD §6: a plain line, no axes jargon. Gaps stay gaps — nothing is interpolated. */
export function Sparkline({ points, platformLabel }: SparklineProps) {
  const first = points[0];
  const last = points.at(-1);

  if (points.length < 2 || !first || !last) {
    return <p style={styles.empty}>Trend appears once there are a couple of days of history.</p>;
  }

  const values = points.map((point) => point.audienceCount);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotHeight = HEIGHT - PADDING * 2;

  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * WIDTH;
    const y = HEIGHT - PADDING - ((value - min) / span) * plotHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const change = last.audienceCount - first.audienceCount;
  const direction = change === 0 ? "no change" : change > 0 ? "up" : "down";

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${platformLabel} audience across the last ${points.length} snapshots: from ${first.audienceCount.toLocaleString()} to ${last.audienceCount.toLocaleString()}, ${direction} ${Math.abs(change).toLocaleString()}.`}
      style={styles.svg}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const styles = {
  svg: {
    display: "block",
    width: "100%",
    height: HEIGHT,
  },
  empty: {
    margin: 0,
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
} satisfies Record<string, CSSProperties>;
