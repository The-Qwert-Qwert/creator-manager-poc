export const MANUAL_REFRESH_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * FR-6: the server — not the button — decides whether a refresh is allowed.
 * Returns 0 when the account is outside its cooldown, otherwise the wait left.
 */
export function cooldownRemainingMs(
  lastManualRefreshAt: string | Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!lastManualRefreshAt) {
    return 0;
  }

  const last =
    lastManualRefreshAt instanceof Date ? lastManualRefreshAt : new Date(lastManualRefreshAt);

  if (Number.isNaN(last.getTime())) {
    return 0;
  }

  return Math.max(0, MANUAL_REFRESH_COOLDOWN_MS - (now.getTime() - last.getTime()));
}

export function cooldownLabel(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Available in ${minutes} min`;
}
