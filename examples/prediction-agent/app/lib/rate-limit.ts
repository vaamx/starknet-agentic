interface RateLimitRule {
  windowMs: number;
  max: number;
  blockMs?: number;
}

interface Bucket {
  hits: number[];
  blockedUntil: number;
  lastSeenAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function compactBuckets(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.blockedUntil < now && bucket.hits.length === 0) {
      buckets.delete(key);
    }
    if (buckets.size <= MAX_BUCKETS) break;
  }
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule
): { allowed: true; remaining: number } | { allowed: false; retryAfterMs: number } {
  const now = Date.now();
  const windowStart = now - rule.windowMs;
  const bucket = buckets.get(key) ?? { hits: [], blockedUntil: 0, lastSeenAt: now };

  bucket.hits = bucket.hits.filter((ts) => ts >= windowStart);
  bucket.lastSeenAt = now;

  if (bucket.blockedUntil > now) {
    buckets.set(key, bucket);
    return { allowed: false, retryAfterMs: bucket.blockedUntil - now };
  }

  if (bucket.hits.length >= rule.max) {
    const blockMs = rule.blockMs ?? rule.windowMs;
    bucket.blockedUntil = now + blockMs;
    buckets.set(key, bucket);
    compactBuckets(now);
    return { allowed: false, retryAfterMs: blockMs };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  compactBuckets(now);

  return { allowed: true, remaining: Math.max(0, rule.max - bucket.hits.length) };
}

