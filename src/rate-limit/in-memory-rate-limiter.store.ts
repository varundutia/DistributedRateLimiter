import {
  RateLimitDecision,
  RateLimiterStore,
  RateLimitOptions,
} from './rate-limit.types';

interface FixedWindowState {
  windowId: number;
  count: number;
}

interface SlidingCounterState {
  currentWindowId: number;
  currentCount: number;
  previousWindowId: number;
  previousCount: number;
}

interface TokenBucketState {
  tokens: number;
  updatedAt: number;
}

export class InMemoryRateLimiterStore implements RateLimiterStore {
  private readonly fixedWindows = new Map<string, FixedWindowState>();
  private readonly slidingLogs = new Map<string, number[]>();
  private readonly slidingCounters = new Map<string, SlidingCounterState>();
  private readonly tokenBuckets = new Map<string, TokenBucketState>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, options: RateLimitOptions): Promise<RateLimitDecision> {
    switch (options.algorithm) {
      case 'fixed-window':
        return this.consumeFixedWindow(key, options);
      case 'sliding-window-log':
        return this.consumeSlidingWindowLog(key, options);
      case 'sliding-window-counter':
        return this.consumeSlidingWindowCounter(key, options);
      case 'token-bucket':
        return this.consumeTokenBucket(key, options);
    }
  }

  private consumeFixedWindow(
    key: string,
    options: RateLimitOptions,
  ): RateLimitDecision {
    const now = this.now();
    const windowId = Math.floor(now / options.windowMs);
    const windowEndsAt = (windowId + 1) * options.windowMs;
    const state = this.fixedWindows.get(key);

    const nextState =
      state && state.windowId === windowId
        ? { windowId, count: state.count + 1 }
        : { windowId, count: 1 };

    this.fixedWindows.set(key, nextState);

    return this.decision({
      allowed: nextState.count <= options.limit,
      current: nextState.count,
      resetAt: windowEndsAt,
      options,
    });
  }

  private consumeSlidingWindowLog(
    key: string,
    options: RateLimitOptions,
  ): RateLimitDecision {
    const now = this.now();
    const lowerBound = now - options.windowMs;
    const log = (this.slidingLogs.get(key) ?? []).filter(
      (timestamp) => timestamp > lowerBound,
    );

    const allowed = log.length < options.limit;
    if (allowed) {
      log.push(now);
    }
    this.slidingLogs.set(key, log);

    const oldest = log[0] ?? now;
    return this.decision({
      allowed,
      current: log.length,
      resetAt: oldest + options.windowMs,
      options,
    });
  }

  private consumeSlidingWindowCounter(
    key: string,
    options: RateLimitOptions,
  ): RateLimitDecision {
    const now = this.now();
    const currentWindowId = Math.floor(now / options.windowMs);
    const currentWindowStartedAt = currentWindowId * options.windowMs;
    const elapsed = now - currentWindowStartedAt;
    const previousWeight = (options.windowMs - elapsed) / options.windowMs;
    const existing = this.slidingCounters.get(key);

    let state: SlidingCounterState;
    if (!existing || currentWindowId - existing.currentWindowId > 1) {
      state = {
        currentWindowId,
        currentCount: 0,
        previousWindowId: currentWindowId - 1,
        previousCount: 0,
      };
    } else if (existing.currentWindowId !== currentWindowId) {
      state = {
        currentWindowId,
        currentCount: 0,
        previousWindowId: existing.currentWindowId,
        previousCount: existing.currentCount,
      };
    } else {
      state = existing;
    }

    const previousCount =
      state.previousWindowId === currentWindowId - 1 ? state.previousCount : 0;
    const estimatedCount = state.currentCount + previousCount * previousWeight;
    const allowed = estimatedCount < options.limit;

    if (allowed) {
      state.currentCount += 1;
    }
    this.slidingCounters.set(key, state);

    return this.decision({
      allowed,
      current: allowed ? estimatedCount + 1 : estimatedCount,
      resetAt: currentWindowStartedAt + options.windowMs,
      options,
    });
  }

  private consumeTokenBucket(
    key: string,
    options: RateLimitOptions,
  ): RateLimitDecision {
    const now = this.now();
    const refillPerMs = options.limit / options.windowMs;
    const state = this.tokenBuckets.get(key) ?? {
      tokens: options.limit,
      updatedAt: now,
    };

    const elapsed = Math.max(0, now - state.updatedAt);
    const availableTokens = Math.min(
      options.limit,
      state.tokens + elapsed * refillPerMs,
    );
    const allowed = availableTokens >= 1;
    const tokens = allowed ? availableTokens - 1 : availableTokens;
    this.tokenBuckets.set(key, { tokens, updatedAt: now });

    const retryAfterMs = allowed ? 0 : Math.ceil((1 - tokens) / refillPerMs);
    const resetAt = now + Math.ceil((options.limit - tokens) / refillPerMs);

    return {
      allowed,
      algorithm: options.algorithm,
      limit: options.limit,
      remaining: Math.max(0, Math.floor(tokens)),
      resetAt,
      retryAfterMs,
      current: options.limit - tokens,
    };
  }

  private decision(input: {
    allowed: boolean;
    current: number;
    resetAt: number;
    options: RateLimitOptions;
  }): RateLimitDecision {
    const retryAfterMs = input.allowed
      ? 0
      : Math.max(0, input.resetAt - this.now());

    return {
      allowed: input.allowed,
      algorithm: input.options.algorithm,
      limit: input.options.limit,
      remaining: Math.max(0, Math.floor(input.options.limit - input.current)),
      resetAt: input.resetAt,
      retryAfterMs,
      current: input.current,
    };
  }
}
