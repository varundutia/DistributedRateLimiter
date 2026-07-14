import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('App rate limiting', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ALGORITHM = 'fixed-window';
    process.env.RATE_LIMIT_MAX = '2';
    process.env.RATE_LIMIT_WINDOW_MS = '60000';
    delete process.env.REDIS_URL;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not rate limit health checks', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('applies the limiter to dummy API routes', async () => {
    const clientId = `test-${Date.now()}`;

    await request(app.getHttpServer())
      .get('/api/dummy')
      .set('x-client-id', clientId)
      .expect(200)
      .expect('X-RateLimit-Algorithm', 'fixed-window');

    await request(app.getHttpServer())
      .get('/api/dummy')
      .set('x-client-id', clientId)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/dummy')
      .set('x-client-id', clientId)
      .expect(429);
  });
});
