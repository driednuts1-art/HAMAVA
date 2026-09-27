import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { RedisClient } from '../../redis/redis.service';
import { ServerOptions } from 'socket.io';

/**
 * FR-59: backs the chat WebSocket gateway with a Redis pub/sub adapter so
 * `server.to(room).emit(...)` correctly reaches a client connected to a
 * *different* backend instance — required for horizontal scaling
 * (product.md §8.4), wired in now even though only one instance runs today.
 *
 * A real, confirmed, pre-existing bug found while verifying Feature 17's
 * WebSocket connection for real (the first real browser client this gateway
 * ever had) — `main.ts`'s own startup log carries a genuine Nest warning
 * that was previously unnoticed: "useWebSocketAdapter() was called after
 * WebSocket gateways were already initialized... will NOT be applied to
 * existing gateways." `main.ts` called `app.init()` (which wires every
 * `@WebSocketGateway` to whatever adapter is active at that moment) *before*
 * `app.useWebSocketAdapter(redisIoAdapter)` — meaning `ChatGateway` had
 * always been bound to Nest's plain default `IoAdapter`, never this one, in
 * every environment this app has ever run in. This Redis pub/sub adapter's
 * own multi-instance benefit was silently inert (correct behavior on the
 * one dev instance that's ever actually run, since same-process room
 * delivery works identically either way — exactly why nothing caught it
 * before). Fixed at the real cause (`main.ts`'s bootstrap ordering — the
 * adapter is now set *before* `app.init()`), which in turn required
 * decoupling this class from `RedisService`'s own DI-managed connection:
 * `RedisService.onModuleInit()` only runs as part of `app.init()`'s
 * lifecycle sweep, so this adapter can no longer depend on it being already
 * connected at the point it itself must run. Two direct, independent `redis`
 * v6 connections (same `createClient({url: REDIS_URL})` shape `RedisService`
 * itself uses, just not literally shared) replace the old
 * `redisService.duplicateForPubSub()` call. Still two dedicated connections,
 * not one: a pub/sub-subscribed `redis` v6 client has real usage
 * restrictions and cannot also run normal commands, so pub/sub can never
 * share a socket with a general-purpose client — that constraint is
 * inherent to the protocol, not a gap in this refactor.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: RedisClient;
  private subClient?: RedisClient;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisUrl = this.app
      .get(ConfigService)
      .getOrThrow<string>('REDIS_URL');

    this.pubClient = createClient({ url: redisUrl });
    this.subClient = createClient({ url: redisUrl });

    this.pubClient.on('error', (err: Error) =>
      this.logger.error(`Redis pub client error: ${err.message}`),
    );
    this.subClient.on('error', (err: Error) =>
      this.logger.error(`Redis sub client error: ${err.message}`),
    );

    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
    this.logger.log('Connected to Redis for WebSocket pub/sub.');
  }

  /**
   * FR-205's browser-origin restriction (`main.ts`'s `app.enableCors()`)
   * only covers Nest's underlying Express/HTTP layer — Socket.IO's
   * engine.io transport (the HTTP long-polling handshake every connection
   * starts with, before an upgrade to a real WebSocket) runs its own,
   * separate CORS check and does not inherit that config at all. Left
   * unset, it defaults to same-origin-only, silently blocking every
   * cross-origin browser client — a real, pre-existing gap that had never
   * been exercised until Feature 17 became the first real browser WS
   * client (docs/requirements.md Feature 17), surfaced directly as a real
   * CORS console error, not assumed. Configured here, centrally, rather
   * than per-gateway (`@WebSocketGateway({ cors: ... })`), matching
   * `main.ts`'s single-source-of-truth posture for this same origin value.
   */
  createIOServer(port: number, options?: ServerOptions) {
    // Comma-separated, matching main.ts's own identical parsing — see that
    // file's comment for why (a real LAN device alongside localhost, never
    // a wildcard).
    const corsOrigins = this.app
      .get(ConfigService)
      .getOrThrow<string>('FRONTEND_ORIGIN')
      .split(',')
      .map((origin) => origin.trim());
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: corsOrigins, credentials: true },
    }) as {
      adapter: (a: unknown) => void;
    };
    if (!this.adapterConstructor) {
      throw new Error(
        'connectToRedis() must be called before createIOServer().',
      );
    }
    server.adapter(this.adapterConstructor);
    return server;
  }

  /**
   * Without this, the underlying redis client's default reconnect strategy
   * retries forever — a process (or a Jest worker) that never calls this
   * never exits on its own, even after every test has finished and passed.
   * Not optional cleanup; call this before closing the app.
   */
  async close(): Promise<void> {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }
}
