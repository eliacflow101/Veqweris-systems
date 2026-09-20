const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function isOnline(lastActive: unknown, now = Date.now()): boolean {
  let timestamp: number | null = null;

  if (lastActive instanceof Date) {
    timestamp = lastActive.getTime();
  } else if (typeof lastActive === "number") {
    timestamp = lastActive;
  } else if (
    typeof lastActive === "object"
    && lastActive !== null
    && "toMillis" in lastActive
    && typeof lastActive.toMillis === "function"
  ) {
    timestamp = lastActive.toMillis();
  }

  return timestamp !== null
    && Number.isFinite(timestamp)
    && timestamp <= now
    && now - timestamp < ONLINE_WINDOW_MS;
}
