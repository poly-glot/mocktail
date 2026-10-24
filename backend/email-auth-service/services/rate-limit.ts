export type RetryAfterSeconds = number;

export function createRateLimiter(
  limit: number,
  windowMs: number,
): (key: string) => RetryAfterSeconds {
  const hits = new Map<string, number[]>();

  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= limit) {
      hits.set(key, recent);
      return Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    }

    recent.push(now);
    hits.set(key, recent);
    return 0;
  };
}
