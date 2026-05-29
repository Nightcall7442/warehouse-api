/**
 * In-process sliding window rate limiter.
 * No external dependency — uses a Map<ip, timestamps[]>.
 *
 * For multi-instance deployments, replace with Redis (ioredis + sliding window script).
 */

type Entry = { timestamps: number[] };

const store = new Map<string, Entry>();

// Prune old entries every 10 minutes to avoid memory growth
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 10 * 60 * 1000);

export type RateLimitOptions = {
  /** Window size in milliseconds */
  windowMs: number;
  /** Max requests allowed per window */
  limit: number;
  /** Key to namespace this limiter (e.g. "login", "register") */
  namespace: string;
};

/**
 * Returns true if the request is allowed, false if it should be blocked.
 * Call this at the start of sensitive mutations.
 */
export function checkRateLimit(ip: string, opts: RateLimitOptions): boolean {
  const key     = `${opts.namespace}:${ip}`;
  const now     = Date.now();
  const cutoff  = now - opts.windowMs;
  const entry   = store.get(key) ?? { timestamps: [] };

  // Slide the window — drop timestamps older than windowMs
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= opts.limit) {
    store.set(key, entry);
    return false; // blocked
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return true; // allowed
}

/** Extract the real client IP from Hono/Node request headers */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}
