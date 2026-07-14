import { InMemoryRateLimiterStore } from '../src/rate-limit/in-memory-rate-limiter.store';
import { RateLimitOptions } from '../src/rate-limit/rate-limit.types';

describe('InMemoryRateLimiterStore', () => {
  let now = 0;

  const store = (): InMemoryRateLimiterStore =>
    new InMemoryRateLimiterStore(() => now);

  it('shows the fixed-window boundary burst tradeoff', async () => {
    const limiter = store();
    const options: RateLimitOptions = {
      algorithm: 'fixed-window',
      limit: 2,
      windowMs: 1_000,
    };

    now = 990;
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: false,
      retryAfterMs: 10,
    });

    now = 1_001;
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });

  it('keeps exact request timestamps for a sliding-window log', async () => {
    const limiter = store();
    const options: RateLimitOptions = {
      algorithm: 'sliding-window-log',
      limit: 2,
      windowMs: 1_000,
    };

    now = 0;
    await limiter.consume('client-a', options);
    now = 100;
    await limiter.consume('client-a', options);

    now = 999;
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: false,
      retryAfterMs: 1,
    });

    now = 1_001;
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it('estimates the previous bucket in a sliding-window counter', async () => {
    const limiter = store();
    const options: RateLimitOptions = {
      algorithm: 'sliding-window-counter',
      limit: 4,
      windowMs: 1_000,
    };

    now = 900;
    await limiter.consume('client-a', options);
    await limiter.consume('client-a', options);
    await limiter.consume('client-a', options);
    await limiter.consume('client-a', options);

    now = 1_500;
    const decision = await limiter.consume('client-a', options);

    expect(decision.allowed).toBe(true);
    expect(decision.current).toBe(3);
    expect(decision.remaining).toBe(1);
  });

  it('refills a token bucket over time', async () => {
    const limiter = store();
    const options: RateLimitOptions = {
      algorithm: 'token-bucket',
      limit: 2,
      windowMs: 1_000,
    };

    now = 0;
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: false,
      retryAfterMs: 500,
    });

    now = 500;
    expect(await limiter.consume('client-a', options)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });
});
