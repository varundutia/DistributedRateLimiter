export const RATE_LIMIT_ALGORITHMS = [
  'fixed-window',
  'sliding-window-log',
  'sliding-window-counter',
  'token-bucket',
] as const;

export type RateLimitAlgorithm = (typeof RATE_LIMIT_ALGORITHMS)[number];

export interface RateLimitOptions {
  algorithm: RateLimitAlgorithm;
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  algorithm: RateLimitAlgorithm;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
  current: number;
}

export interface RateLimiterStore {
  consume(key: string, options: RateLimitOptions): Promise<RateLimitDecision>;
  disconnect?(): Promise<void>;
}

export function parseAlgorithm(value: string | undefined): RateLimitAlgorithm {
  if (RATE_LIMIT_ALGORITHMS.includes(value as RateLimitAlgorithm)) {
    return value as RateLimitAlgorithm;
  }

  return 'token-bucket';
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}
