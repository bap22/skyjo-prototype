// ─── State Store ─────────────────────────────────────────────────────────────
// Uses Upstash Redis if env vars are set, otherwise falls back to in-process
// memory (works for local dev; for prod you MUST set UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN in Vercel env vars).

let redisClient = null;

async function getRedis() {
  if (redisClient) return redisClient;
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = await import('@upstash/redis');
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    return redisClient;
  }
  return null;
}

// In-memory fallback (single process only)
const memStore = new Map();

export async function storeGet(key) {
  const redis = await getRedis();
  if (redis) {
    const val = await redis.get(key);
    return val;
  }
  return memStore.get(key) ?? null;
}

export async function storeSet(key, value, exSeconds = 3600 * 6) {
  const redis = await getRedis();
  if (redis) {
    await redis.set(key, value, { ex: exSeconds });
    return;
  }
  memStore.set(key, value);
}

export async function storeDel(key) {
  const redis = await getRedis();
  if (redis) {
    await redis.del(key);
    return;
  }
  memStore.delete(key);
}

export async function storeKeys(pattern) {
  const redis = await getRedis();
  if (redis) {
    return await redis.keys(pattern);
  }
  const keys = [];
  for (const k of memStore.keys()) {
    if (pattern === '*' || k.startsWith(pattern.replace('*', ''))) keys.push(k);
  }
  return keys;
}
