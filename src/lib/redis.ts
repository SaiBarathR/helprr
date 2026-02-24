import { createClient } from 'redis';

type HelprrRedisClient = ReturnType<typeof createClient>;

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: HelprrRedisClient;
  redisConnectPromise?: Promise<HelprrRedisClient>;
};

export async function getRedisClient(): Promise<HelprrRedisClient> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL env var is required');
  }

  if (!globalForRedis.redisClient) {
    const client = createClient({ url: redisUrl });
    client.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Redis] Client error:', message);
    });
    globalForRedis.redisClient = client;
  }

  const client = globalForRedis.redisClient;
  if (client.isOpen) return client;

  if (!globalForRedis.redisConnectPromise) {
    globalForRedis.redisConnectPromise = client.connect()
      .then(() => client)
      .finally(() => {
        globalForRedis.redisConnectPromise = undefined;
      });
  }

  return globalForRedis.redisConnectPromise;
}
