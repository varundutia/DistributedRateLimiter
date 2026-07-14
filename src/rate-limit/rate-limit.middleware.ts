import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import { RateLimitDecision } from './rate-limit.types';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const identifier = this.identifierFor(req);
    const decision = await this.rateLimitService.consume(identifier);
    this.attachHeaders(res, decision);

    if (!decision.allowed) {
      res.status(429).json({
        error: 'Too Many Requests',
        algorithm: decision.algorithm,
        retryAfterMs: decision.retryAfterMs,
      });
      return;
    }

    next();
  }

  private identifierFor(req: Request): string {
    const explicitClientId = req.header('x-client-id');
    if (explicitClientId) {
      return explicitClientId;
    }

    return req.ip || req.socket.remoteAddress || 'anonymous';
  }

  private attachHeaders(res: Response, decision: RateLimitDecision): void {
    const windowSeconds = Math.ceil(
      this.rateLimitService.getConfig().windowMs / 1000,
    );

    res.setHeader('RateLimit-Policy', `${decision.limit};w=${windowSeconds}`);
    res.setHeader('RateLimit-Limit', decision.limit.toString());
    res.setHeader('RateLimit-Remaining', decision.remaining.toString());
    res.setHeader('RateLimit-Reset', Math.ceil(decision.resetAt / 1000).toString());
    res.setHeader('X-RateLimit-Algorithm', decision.algorithm);

    if (!decision.allowed) {
      res.setHeader(
        'Retry-After',
        Math.ceil(decision.retryAfterMs / 1000).toString(),
      );
    }
  }
}
