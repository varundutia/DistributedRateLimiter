import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { InMemoryRateLimiterStore } from './in-memory-rate-limiter.store';
import { RedisLuaRateLimiterStore } from './redis-lua-rate-limiter.store';
import {
  parseAlgorithm,
  positiveInteger,
  RateLimitDecision,
  RateLimiterStore,
  RateLimitOptions,
} from './rate-limit.types';

export interface RateLimitRuntimeConfig extends RateLimitOptions {
  keyPrefix: string;
  usingRedis: boolean;
}

@Injectable()
export class RateLimitService implements OnModuleDestroy {
  private readonly store: RateLimiterStore;
  private readonly config: RateLimitRuntimeConfig;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    this.config = {
      algorithm: parseAlgorithm(process.env.RATE_LIMIT_ALGORITHM),
      limit: positiveInteger(process.env.RATE_LIMIT_MAX, 10),
      windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
      keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX ?? 'rate-limit',
      usingRedis: Boolean(redisUrl),
    };

    this.store = redisUrl
      ? new RedisLuaRateLimiterStore(
          new Redis(redisUrl, {
            maxRetriesPerRequest: 2,
            lazyConnect: false,
          }),
        )
      : new InMemoryRateLimiterStore();
  }

  getConfig(): RateLimitRuntimeConfig {
    return this.config;
  }

  consume(identifier: string): Promise<RateLimitDecision> {
    const key = `${this.config.keyPrefix}:${this.config.algorithm}:${identifier}`;
    return this.store.consume(key, this.config);
  }

  async onModuleDestroy(): Promise<void> {
    await this.store.disconnect?.();
  }
}
