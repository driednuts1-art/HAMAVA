import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { RedisIoAdapter } from './common/websocket/redis-io.adapter';
import { registerGracefulShutdown } from './common/graceful-shutdown';

// Fail-safe ceiling on graceful shutdown (docs/architecture.md §5.3): if
// closing Redis/the app hangs (e.g. a network issue mid-quit), force exit
// anyway rather than leaving an unkillable process — the exact failure mode
// this constant exists to prevent from recurring in a real deployment.
const SHUTDOWN_TIMEOUT_MS = 5000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // FR-205 (Feature 14): the real browser origin(s) allowed to call this API
  // directly — never a wildcard. `credentials: true` matters only for the
  // frontend's own Route Handlers that read this API's Set-Cookie headers
  // server-side (docs/requirements.md Feature 14 FR-207); the browser itself
  // never receives this backend's cookies (it has none to send).
  //
  // A comma-separated list, not a single value — added so a real device on
  // the same LAN (e.g. a phone, reaching this backend via its real
  // 192.168.x.x address) can be allowed alongside localhost during dev,
  // without silently widening this to a wildcard. Each origin is still an
  // explicit, reviewed value in `.env`, never inferred or guessed.
  app.enableCors({
    origin: app
      .get(ConfigService)
      .getOrThrow<string>('FRONTEND_ORIGIN')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });

  app.use(helmet());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());

  // FR-59: the chat gateway's Redis pub/sub adapter — must be set *before*
  // app.init(), not after. A real, confirmed bug (see redis-io.adapter.ts's
  // own header comment): app.init() is what wires every @WebSocketGateway to
  // whichever adapter is active at that exact moment — setting the adapter
  // afterward is silently a no-op for gateways, confirmed directly by Nest's
  // own runtime warning ("will NOT be applied to existing gateways"), not
  // the "no-op re-init" this code used to (incorrectly) assume. This
  // ordering only became possible once RedisIoAdapter stopped depending on
  // RedisService's own DI-managed connection (only available once
  // onModuleInit hooks run, i.e. only after init()) — it now opens two
  // direct, independent Redis connections of its own.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // init() (route/gateway registration) now runs with the real adapter
  // already in place. app.listen() below is a no-op re-init on top of this
  // one, per Nest's own idempotency guard — unchanged from before.
  await app.init();

  const config = new DocumentBuilder()
    .setTitle('Hamava API')
    .setDescription('Phone auth + liveness verification (docs/requirements.md)')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // The Redis clients backing the chat gateway aren't Nest-managed providers,
  // so app.close() alone doesn't know about them — without this, a graceful
  // shutdown would leave their reconnect loop running (see redis-io.adapter.ts).
  registerGracefulShutdown({
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    onShutdown: async () => {
      await redisIoAdapter.close();
      await app.close();
    },
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  // Covers ProductionSafetyService refusing to start (see docs/roadmap.md)
  // as well as any other bootstrap failure — fail loudly, not silently.
  new Logger('Bootstrap').error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
