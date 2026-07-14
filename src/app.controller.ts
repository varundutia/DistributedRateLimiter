import { Controller, Get } from '@nestjs/common';
import { RateLimitService } from './rate-limit/rate-limit.service';

@Controller()
export class AppController {
  constructor(private readonly rateLimitService: RateLimitService) {}

  @Get('health')
  health(): { ok: true } {
    return { ok: true };
  }

  @Get('api/dummy')
  dummy(): { ok: true; message: string; timestamp: string } {
    return {
      ok: true,
      message: 'This route is protected by the distributed rate limiter.',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('api/rate-limit/config')
  config() {
    return this.rateLimitService.getConfig();
  }
}
