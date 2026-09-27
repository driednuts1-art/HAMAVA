import { Injectable, Logger } from '@nestjs/common';
import {
  RedisService,
  isRedisUnavailableError,
} from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

// Feature 27 (docs/requirements.md §2): 45s TTL under a 20s client heartbeat
// (frontend/lib/websocket-client.ts) — tolerates up to two missed beats
// (a transient blip) before genuinely going offline, converging to
// "offline" within under a minute of a real disconnect either way.
const ONLINE_TTL_SECONDS = 45;

function onlineKey(userId: string): string {
  return `presence:online:${userId}`;
}

function socketsKey(userId: string): string {
  return `presence:sockets:${userId}`;
}

export interface PresenceValue {
  online: boolean;
  lastOnlineAt: Date | null;
}

/**
 * Feature 27 (docs/requirements.md §2): live presence, backed by the same
 * shared Redis instance RedisIoAdapter already uses for cross-instance chat
 * delivery (FR-59) — connection state is high-churn and ephemeral, so it
 * never touches Postgres except for the one durable fact in recordLastSeen()
 * (§2.3). `ChatGateway` is this app's only real-time transport (FR-330) and
 * is the sole caller of connect/heartbeat/disconnect below.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * A real, reproducible shutdown-ordering race, found running the full
   * backend e2e regression (docs/roadmap.md "Known infrastructure debt"):
   * `app.close()` tears down the WS gateway (disconnecting every live
   * socket, firing `ChatGateway.handleDisconnect` for each) and runs every
   * provider's `onModuleDestroy` (including `RedisService`'s `client.quit()`)
   * as part of the same teardown, with no ordering guarantee between the
   * two — a disconnect handler still in flight when the client finishes
   * closing throws `ClientClosedError`. Confirmed reachable in real
   * production, not just tests: `main.ts`'s own graceful-shutdown path goes
   * through this identical `app.close()` machinery, so any real deploy/
   * restart while users hold an open WebSocket connection can hit this.
   *
   * Broadened (docs/roadmap.md) to also cover `ClientOfflineError` — thrown
   * immediately, per-command, once `RedisService`'s `disableOfflineQueue`
   * is on, for any command issued during a genuine, live outage (not just
   * post-shutdown). Presence is explicitly a "nice to have," not a safety
   * mechanism (per user direction): every write here fails OPEN on either
   * case — a missed connect/heartbeat/disconnect write just means presence
   * self-heals via the existing 45s TTL (FR-483) once Redis recovers,
   * never something worth surfacing as a request failure.
   */
  private isSkippableRedisError(error: unknown): boolean {
    return isRedisUnavailableError(error);
  }

  /** FR-480: registers one live connection and (re)starts the 45s online TTL. */
  async recordConnect(userId: string, socketId: string): Promise<void> {
    try {
      await this.redis.client.sAdd(socketsKey(userId), socketId);
      await this.redis.client.set(onlineKey(userId), '1', {
        EX: ONLINE_TTL_SECONDS,
      });
    } catch (error) {
      if (!this.isSkippableRedisError(error)) throw error;
      this.logger.warn(
        `Skipped recordConnect for ${userId}: Redis unavailable (${error instanceof Error ? error.message : 'unknown'}).`,
      );
    }
  }

  /** FR-480: refreshes the 45s TTL — called on every client `presence:heartbeat`. */
  async recordHeartbeat(userId: string): Promise<void> {
    try {
      await this.redis.client.expire(onlineKey(userId), ONLINE_TTL_SECONDS);
    } catch (error) {
      if (!this.isSkippableRedisError(error)) throw error;
      this.logger.warn(
        `Skipped recordHeartbeat for ${userId}: Redis unavailable (${error instanceof Error ? error.message : 'unknown'}).`,
      );
    }
  }

  /**
   * FR-481/FR-482: removes exactly this one connection. Only once the
   * user's *last* tracked connection is gone (`SCARD === 0`) does this mark
   * them offline immediately (rather than waiting up to 45s for the TTL)
   * and stamp the one durable `lastOnlineAt` write.
   */
  async recordDisconnect(userId: string, socketId: string): Promise<void> {
    try {
      await this.redis.client.sRem(socketsKey(userId), socketId);
      const remaining = await this.redis.client.sCard(socketsKey(userId));
      if (remaining > 0) return; // FR-481: other tabs/devices still live.

      // Real, found-via-a-real-e2e-run ordering fix: lastOnlineAt is stamped
      // BEFORE the online key is deleted — otherwise a reader could observe
      // the narrow window where online has already flipped false but
      // lastOnlineAt hasn't been written yet, seeing an honest-looking but
      // momentarily-stale `{online: false, lastOnlineAt: null}`.
      await this.recordLastSeen(userId);
      await this.redis.client.del(onlineKey(userId));
    } catch (error) {
      if (!this.isSkippableRedisError(error)) throw error;
      this.logger.warn(
        `Skipped recordDisconnect for ${userId}: Redis unavailable (${error instanceof Error ? error.message : 'unknown'}).`,
      );
    }
  }

  private async recordLastSeen(userId: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastOnlineAt: new Date() },
      });
    } catch (error) {
      // Defensive only: a user row could in principle be deleted between
      // the disconnect event and this write (account deletion mid-session).
      this.logger.warn(
        `Failed to record lastOnlineAt for ${userId}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  /**
   * FR-480/FR-486: batched — one Redis round trip for an entire page of
   * candidates/matches, never one EXISTS per row (mirrors deck.service.ts's
   * own batched photo-URL pattern).
   *
   * FR-483: a real, explicitly accepted approximation, not a silent gap —
   * self-heals a crash-orphaned `presence:sockets:<userId>` set (stuck
   * non-empty because handleDisconnect never ran on a dead instance) the
   * moment a read discovers the inconsistency (online key already expired,
   * but the sockets set still isn't empty), rather than requiring this
   * user's next legitimate connect+disconnect cycle to notice at all.
   */
  async getOnlineMap(userIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (userIds.length === 0) return result;

    // Presence is explicitly a "nice to have," not a safety mechanism (per
    // user direction) — this is the read path every discovery/matches/chat
    // list load depends on, and previously had NO guard at all, meaning a
    // real Redis outage would throw here and fail the *entire* page, not
    // just the presence dot. Fails open: everyone reads as offline (the
    // same value an expired/never-set online key already produces today),
    // never a thrown error.
    try {
      const pipeline = this.redis.client.multi();
      for (const id of userIds) pipeline.exists(onlineKey(id));
      const existsResults = (await pipeline.exec()) as unknown as number[];

      await Promise.all(
        userIds.map(async (id, index) => {
          const isOnline = existsResults[index] === 1;
          result.set(id, isOnline);
          if (isOnline) return;

          // FR-483 self-heal: only worth the extra round trip for users we
          // just found offline, and only actually does anything on the rare
          // crash-orphaned path (SCARD > 0 despite no live online key).
          const remaining = await this.redis.client.sCard(socketsKey(id));
          if (remaining > 0) {
            await this.redis.client.del(socketsKey(id));
            await this.recordLastSeen(id);
          }
        }),
      );
    } catch (error) {
      if (!this.isSkippableRedisError(error)) throw error;
      this.logger.warn(
        `getOnlineMap treating ${userIds.length} user(s) as offline: Redis unavailable (${error instanceof Error ? error.message : 'unknown'}).`,
      );
      for (const id of userIds) result.set(id, false);
    }

    return result;
  }

  /**
   * FR-485: the one, centrally-enforced symmetric privacy rule — presence
   * is computed and shown for a viewer/target pair only when BOTH have
   * showLastActiveStatus on; otherwise genuinely absent (null), never
   * "shown as offline," in both directions at once.
   */
  buildPresenceField(
    viewerAllowsSeeing: boolean,
    targetAllows: boolean,
    online: boolean,
    lastOnlineAt: Date | null,
  ): PresenceValue | null {
    if (!viewerAllowsSeeing || !targetAllows) return null;
    return { online, lastOnlineAt };
  }
}
