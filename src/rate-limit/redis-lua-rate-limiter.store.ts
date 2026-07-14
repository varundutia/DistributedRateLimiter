import Redis from 'ioredis';
import {
  RateLimitDecision,
  RateLimiterStore,
  RateLimitOptions,
} from './rate-limit.types';

const LUA_CONSUME_SCRIPT = `
local algorithm = ARGV[1]
local now = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local window = tonumber(ARGV[4])
local base = KEYS[1]

local function clamp_remaining(current)
  local remaining = math.floor(limit - current)
  if remaining < 0 then
    return 0
  end
  return remaining
end

if algorithm == 'fixed-window' then
  local window_id = math.floor(now / window)
  local key = base .. ':fw:' .. window_id
  local current = tonumber(redis.call('INCR', key))
  redis.call('PEXPIRE', key, window + 1000)
  local reset_at = (window_id + 1) * window
  local allowed = current <= limit and 1 or 0
  local retry_after = allowed == 1 and 0 or reset_at - now
  return { allowed, limit, clamp_remaining(current), reset_at, retry_after, current }
end

if algorithm == 'sliding-window-log' then
  local key = base .. ':swl'
  local seq_key = base .. ':swl:seq'
  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
  local current = tonumber(redis.call('ZCARD', key))
  local allowed = current < limit and 1 or 0
  if allowed == 1 then
    local sequence = tonumber(redis.call('INCR', seq_key))
    redis.call('ZADD', key, now, tostring(now) .. '-' .. tostring(sequence))
    current = current + 1
  end
  redis.call('PEXPIRE', key, window + 1000)
  redis.call('PEXPIRE', seq_key, window + 1000)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset_at = now + window
  if oldest[2] then
    reset_at = tonumber(oldest[2]) + window
  end
  local retry_after = allowed == 1 and 0 or reset_at - now
  return { allowed, limit, clamp_remaining(current), reset_at, retry_after, current }
end

if algorithm == 'sliding-window-counter' then
  local window_id = math.floor(now / window)
  local current_key = base .. ':swc:' .. window_id
  local previous_key = base .. ':swc:' .. (window_id - 1)
  local current_count = tonumber(redis.call('GET', current_key) or '0')
  local previous_count = tonumber(redis.call('GET', previous_key) or '0')
  local current_window_started_at = window_id * window
  local elapsed = now - current_window_started_at
  local previous_weight = (window - elapsed) / window
  local estimated = current_count + (previous_count * previous_weight)
  local allowed = estimated < limit and 1 or 0
  if allowed == 1 then
    current_count = tonumber(redis.call('INCR', current_key))
    redis.call('PEXPIRE', current_key, (window * 2) + 1000)
    estimated = estimated + 1
  end
  local reset_at = current_window_started_at + window
  local retry_after = allowed == 1 and 0 or reset_at - now
  return { allowed, limit, clamp_remaining(estimated), reset_at, retry_after, estimated }
end

if algorithm == 'token-bucket' then
  local key = base .. ':tb'
  local tokens = tonumber(redis.call('HGET', key, 'tokens') or tostring(limit))
  local updated_at = tonumber(redis.call('HGET', key, 'updatedAt') or tostring(now))
  local refill_per_ms = limit / window
  local elapsed = now - updated_at
  if elapsed < 0 then
    elapsed = 0
  end
  tokens = math.min(limit, tokens + (elapsed * refill_per_ms))
  local allowed = tokens >= 1 and 1 or 0
  if allowed == 1 then
    tokens = tokens - 1
  end
  redis.call('HSET', key, 'tokens', tostring(tokens), 'updatedAt', tostring(now))
  redis.call('PEXPIRE', key, (window * 2) + 1000)
  local retry_after = 0
  if allowed == 0 then
    retry_after = math.ceil((1 - tokens) / refill_per_ms)
  end
  local reset_at = now + math.ceil((limit - tokens) / refill_per_ms)
  return { allowed, limit, math.floor(tokens), reset_at, retry_after, limit - tokens }
end

return redis.error_reply('unknown rate limit algorithm: ' .. algorithm)
`;

export class RedisLuaRateLimiterStore implements RateLimiterStore {
  private scriptSha?: string;

  constructor(private readonly redis: Redis) {}

  async consume(key: string, options: RateLimitOptions): Promise<RateLimitDecision> {
    const now = Date.now();
    const result = await this.evalConsumeScript(key, options, now);
    const [allowed, limit, remaining, resetAt, retryAfterMs, current] =
      result.map(Number);

    return {
      allowed: allowed === 1,
      algorithm: options.algorithm,
      limit,
      remaining,
      resetAt,
      retryAfterMs,
      current,
    };
  }

  async disconnect(): Promise<void> {
    this.redis.disconnect();
  }

  private async evalConsumeScript(
    key: string,
    options: RateLimitOptions,
    now: number,
  ): Promise<unknown[]> {
    const args = [
      options.algorithm,
      now.toString(),
      options.limit.toString(),
      options.windowMs.toString(),
    ];

    if (!this.scriptSha) {
      this.scriptSha = await this.loadScript();
    }

    const scriptSha = this.scriptSha;

    try {
      return (await this.redis.evalsha(
        scriptSha,
        1,
        key,
        ...args,
      )) as unknown[];
    } catch (error) {
      if (error instanceof Error && error.message.includes('NOSCRIPT')) {
        this.scriptSha = await this.loadScript();
        return (await this.redis.evalsha(
          this.scriptSha,
          1,
          key,
          ...args,
        )) as unknown[];
      }

      throw error;
    }
  }

  private async loadScript(): Promise<string> {
    const sha = await this.redis.script('LOAD', LUA_CONSUME_SCRIPT);
    if (typeof sha !== 'string') {
      throw new Error('Redis SCRIPT LOAD did not return a script SHA.');
    }

    return sha;
  }
}
