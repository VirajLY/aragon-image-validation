import Redis from 'ioredis';
import { config } from '../config';

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy: (times: number) => {
    if (times > 2) {
      return null; // Don't crash if Redis is unavailable in local dev
    }
    return Math.min(times * 300, 1000);
  },
};

/**
 * Shared Redis connection for BullMQ and pub/sub.
 */
export const redis = new Redis(config.REDIS_URL, redisOptions);

/**
 * Dedicated Redis connection for subscribers.
 */
export const redisSub = new Redis(config.REDIS_URL, redisOptions);

redis.connect().catch(() => {
  console.log('ℹ️  Redis offline — system using in-process async queue');
});

redisSub.connect().catch(() => {
  console.log('ℹ️  Redis pub/sub offline — system using in-memory SSE broadcaster');
});

redis.on('error', (_err) => {
  // Gracefully ignored when offline
});

redisSub.on('error', (_err) => {
  // Gracefully ignored when offline
});
