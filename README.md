# Distributed Rate Limiter

NestJS examples for four rate limiting algorithms, first as local logic and then as a Redis-backed distributed limiter with atomic Lua check-and-increment.

## What Is Included

- Fixed-window counter: cheapest state, but allows boundary bursts.
- Sliding-window log: most accurate, but stores one timestamp per request.
- Sliding-window counter: small state with weighted previous-window approximation.
- Token bucket: burst-friendly limiter commonly used in production APIs.
- Redis shared state for multi-instance deployments.
- Lua script so every consume operation is atomic.
- NestJS middleware protecting `/api/*`.
- Dummy API at `GET /api/dummy`.

## Run Locally

```bash
npm install
npm run start:dev
```

Without `REDIS_URL`, the app uses the in-memory store. That is useful for tests and demos, but it is not distributed.

With Docker:

```bash
docker compose up --build
```

Then try:

```bash
curl -i -H 'x-client-id: alice' http://localhost:3000/api/dummy
curl -i -H 'x-client-id: alice' http://localhost:3000/api/rate-limit/config
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `REDIS_URL` | unset | Enables Redis/Lua distributed mode when set. |
| `RATE_LIMIT_ALGORITHM` | `token-bucket` | One of `fixed-window`, `sliding-window-log`, `sliding-window-counter`, `token-bucket`. |
| `RATE_LIMIT_MAX` | `10` | Requests or bucket capacity per window. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window duration and token refill interval. |
| `RATE_LIMIT_KEY_PREFIX` | `rate-limit` | Redis key prefix. |

## Atomic Redis Path

The Redis store loads one Lua script and calls it through `EVALSHA`. The script handles pruning, counting, incrementing, token refill, TTLs, and response metadata in a single Redis operation, which avoids the classic race in naive code:

```text
count = GET key
if count < limit:
  INCR key
```

When two API instances do that naive sequence at the same time, both can observe the same old count and both allow the request. The Lua version makes the whole decision indivisible.

## Tradeoffs

| Algorithm | Memory | Accuracy | Production Fit |
| --- | --- | --- | --- |
| Fixed window | O(1) per key/window | Low near boundaries | Good for simple quotas. |
| Sliding-window log | O(requests) per key/window | Exact | Good when limits are small and precision matters. |
| Sliding-window counter | O(1) per key/window | Approximate | Good compromise for high-cardinality clients. |
| Token bucket | O(1) per key | Smooth refill with controlled burst | Common API default. |

## Test

```bash
npm test
npm run build
```
