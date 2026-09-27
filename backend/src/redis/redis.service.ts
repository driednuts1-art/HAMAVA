import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

export type RedisClient = ReturnType<typeof createClient>;

/**
 * Both `ClientClosedError` (post-`.quit()`, e.g. app shutdown) and
 * `ClientOfflineError` (`disableOfflineQueue: true` below — thrown
 * immediately for any command issued while a real outage's reconnect loop
 * hasn't yet re-established the connection, instead of queuing the command
 * silently forever) extend `Error` via `super(message)` only and never set
 * `this.name` — `error.constructor.name` is what actually carries the real
 * subclass name. Verified directly against the installed package's own
 * source (`@redis/client/dist/lib/errors.js`), not assumed. Centralized
 * here after the identical check was about to be duplicated a second time
 * (`PresenceService`, `ConversationalSetupSessionStore`) — every consumer of
 * `RedisService.client` should treat these two the same way: "Redis is
 * genuinely unavailable right now," as distinct from any other real bug.
 */
export function isRedisUnavailableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.constructor.name === 'ClientClosedError' ||
      error.constructor.name === 'ClientOfflineError')
  );
}

/**
 * The single place that knows how to open a Redis connection to this app's
 * instance (docs/architecture.md §5.11) — mirrors `PrismaService`. Every
 * general-purpose (non-pub/sub) Redis consumer injects this and uses
 * `.client` instead of calling `createClient()` itself, so connection URL,
 * TLS options, and error handling live in one place.
 *
 * Pub/sub is a real exception, not an oversight: a subscribed `redis` v6
 * client has genuine usage restrictions and cannot also run normal commands,
 * so it always needs its own dedicated connection. `duplicateForPubSub()`
 * still routes that connection's config through this service rather than
 * letting a second call site hardcode the URL independently.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private _client!: RedisClient;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this._client = createClient({
      url: this.config.getOrThrow<string>('REDIS_URL'),
      // A real, found-not-guessed gap (docs/roadmap.md): without this, a
      // command issued during a genuine outage queues silently and its
      // promise never settles until the connection recovers — every caller
      // hangs for the outage's full duration instead of failing fast.
      // Deliberately NOT applied to RedisIoAdapter's own two pub/sub
      // clients — `@socket.io/redis-adapter`'s internals call
      // `pubClient.publish()` in over a dozen places with no `.catch()`,
      // so an immediate rejection there would surface as a real unhandled
      // promise rejection (which crashes the process by Node's own
      // default), not a caught, handleable error. Chat's own persistence
      // (message.service.ts's `prisma.message.create()`) already completes
      // and returns before the separate, fire-and-forget
      // `chatGateway.pushNewMessage()` push is even attempted, so leaving
      // that pair on the default (safe, silent) queuing behavior costs
      // nothing — a message is never lost, only its live push may be
      // delayed or dropped, exactly FR-58's already-documented contract.
      disableOfflineQueue: true,
    });
    this._client.on('error', (err: Error) =>
      this.logger.error(`Redis client error: ${err.message}`),
    );
    await this._client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this._client?.quit();
  }

  get client(): RedisClient {
    return this._client;
  }

  duplicateForPubSub(): RedisClient {
    const dup = this._client.duplicate();
    dup.on('error', (err: Error) =>
      this.logger.error(`Redis pub/sub client error: ${err.message}`),
    );
    return dup;
  }
}
