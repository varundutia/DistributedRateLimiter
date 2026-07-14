import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { RateLimitMiddleware } from './rate-limit/rate-limit.middleware';
import { RateLimitModule } from './rate-limit/rate-limit.module';

@Module({
  imports: [RateLimitModule],
  controllers: [AppController],
  providers: [RateLimitMiddleware],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RateLimitMiddleware).forRoutes('api');
  }
}
