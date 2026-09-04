import type { FastifyRequest, FastifyReply } from "fastify";

interface TokenBucket {
  tokens: number;
  last_refill: number;
}

const buckets = new Map<string, TokenBucket>();

const MAX_TOKENS = 100;
const REFILL_RATE = 10; // tokens per second
const REFILL_INTERVAL_MS = 1000;

/**
 * Which bucket a request draws from.
 *
 * A client key is public — a web app ships it inside the page and a mobile app
 * ships it inside the binary — so one bucket per client key is really one
 * bucket for every visitor of that app at once: the busiest site would rate
 * limit its own users, and any one visitor could drain the key for all of them.
 * Client keys therefore bucket per key *and* caller IP.
 *
 * Agent and import keys are operator credentials held by one caller, and a
 * signed-in user is already one identity, so both keep a single bucket — an
 * IP split there would only hand a caller more quota by changing address.
 *
 * `request.ip` is the socket address unless `TRUST_PROXY` is on, in which case
 * it follows `X-Forwarded-For`. Trusting that header on a directly reachable
 * server would let a caller pick its own bucket, which is why it is off by
 * default.
 */
function getRateLimitBucketKey(request: FastifyRequest): string {
  if (request.auth) {
    if (request.auth.type !== "api_key") return `user:${request.auth.user_id}`;
    return request.auth.key_type === "client"
      ? `key:${request.auth.key_id}:ip:${request.ip}`
      : `key:${request.auth.key_id}`;
  }
  return `ip:${request.ip}`;
}

export async function rateLimit(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const key = getRateLimitBucketKey(request);
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: MAX_TOKENS, last_refill: now };
    buckets.set(key, bucket);
  }

  // Refill tokens
  const elapsed = now - bucket.last_refill;
  const refill = Math.floor(elapsed / REFILL_INTERVAL_MS) * REFILL_RATE;
  if (refill > 0) {
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + refill);
    bucket.last_refill = now;
  }

  if (bucket.tokens <= 0) {
    reply.header("Retry-After", "1");
    return reply.code(429).send({ error: "Rate limit exceeded" });
  }

  bucket.tokens--;
}

/** Test-only: drop every bucket so a suite can start from a known state. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

// Cleanup old buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, bucket] of buckets) {
    if (bucket.last_refill < cutoff) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();
