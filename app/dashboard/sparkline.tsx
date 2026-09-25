import type { SnapshotPoint } from "@/lib/dashboard/metrics";

const WIDTH = 200;
const HEIGHT = 38;
const PADDING = 3;

interface SparklineProps {
  points: readonly SnapshotPoint[];
  platformLabel: string;
}

/** Plain trend line with a subtle area fill. Gaps are never interpolated. */
export function Sparkline({ points, platformLabel }: SparklineProps) {
  const first = points[0];
  const last = points.at(-1);

  if (points.length < 2 || !first || !last) {
    return <p className="trend-empty">Trend appears after a couple of days.</p>;
  }

  const values = points.map((point) => point.audienceCount);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const plotHeight = HEIGHT - PADDING * 2;

  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * WIDTH;
    const y = HEIGHT - PADDING - ((value - min) / span) * plotHeight;
    return [x, y] as const;
  });
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `0,${HEIGHT} ${line} ${WIDTH},${HEIGHT}`;
  const change = last.audienceCount - first.audienceCount;
  const direction = change === 0 ? "no change" : change > 0 ? "up" : "down";

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${platformLabel} audience across the last ${points.length} snapshots: from ${first.audienceCount.toLocaleString()} to ${last.audienceCount.toLocaleString()}, ${direction} ${Math.abs(change).toLocaleString()}.`}
      className="sparkline"
    >
      <polygon className="sparkline-area" points={area} />
      <polyline
        className="sparkline-line"
        points={line}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
