import { createClient } from 'redis';

type HelprrRedisClient = ReturnType<typeof createClient>;

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: HelprrRedisClient;
  redisConnectPromise?: Promise<HelprrRedisClient>;
  redisDisconnectPromise?: Promise<void>;
  redisShutdownHandlersRegistered?: boolean;
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
    client.on('connect', () => {
      console.log('[Redis] Client connected');
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

export async function disconnectRedisClient(): Promise<void> {
  if (globalForRedis.redisDisconnectPromise) {
    return globalForRedis.redisDisconnectPromise;
  }

  const client = globalForRedis.redisClient;
  if (!client) return;

  globalForRedis.redisDisconnectPromise = (async () => {
    try {
      if (client.isOpen) {
        await client.quit();
        console.log('[Redis] Client disconnected');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Redis] Failed to disconnect client:', message);
    } finally {
      if (globalForRedis.redisClient === client) {
        globalForRedis.redisClient = undefined;
      }
      globalForRedis.redisConnectPromise = undefined;
      globalForRedis.redisDisconnectPromise = undefined;
    }
  })();

  return globalForRedis.redisDisconnectPromise;
}

export function registerRedisShutdownHandlers(): void {
  if (globalForRedis.redisShutdownHandlersRegistered) return;

  const onShutdown = (signal: string) => {
    void disconnectRedisClient().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Redis] Shutdown handler (${signal}) failed:`, message);
    });
  };

  process.on('beforeExit', () => onShutdown('beforeExit'));
  process.on('SIGINT', () => onShutdown('SIGINT'));
  process.on('SIGTERM', () => onShutdown('SIGTERM'));

  globalForRedis.redisShutdownHandlersRegistered = true;
}
