import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  RedisService,
  isRedisUnavailableError,
} from '../../../redis/redis.service';
import { ConversationalSetupSession } from './types';

const SESSION_KEY_PREFIX = 'conv-setup:session:';
const ACTIVE_USER_KEY_PREFIX = 'conv-setup:active-user:';

/**
 * FR-132/FR-143/FR-144 (requirements.md Feature 11, Open Items #2): the
 * ephemeral, auto-expiring store for the turn-by-turn conversation — under
 * its own key prefix on the shared `RedisService` connection
 * (docs/architecture.md §5.11), deliberately NOT `RedisIoAdapter`'s
 * pub/sub-mode client (mixing concerns there would be fragile — a
 * pub/sub-subscribed client has real usage restrictions in the `redis`
 * package). There is no Prisma model backing this — non-retention of the
 * conversation is structural (no table to forget to clean up), not a
 * retention policy that could be misconfigured.
 *
 * Open Items #3: one active session per user — starting a new one silently
 * discards any existing one for the same user via the `active-user` pointer.
 */
@Injectable()
export class ConversationalSetupSessionStore {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private get client() {
    return this.redis.client;
  }

  private ttlSeconds(): number {
    return (
      this.config.getOrThrow<number>(
        'CONVERSATIONAL_SETUP_SESSION_TTL_MINUTES',
      ) * 60
    );
  }

  /**
   * Unlike Presence (best-effort) or chat (message persistence is already
   * independent of the live push), this feature has no fallback path of its
   * own once a session can't be read/written — the whole conversational
   * flow lives in Redis only, by design (no Prisma model backs it, see this
   * file's own header). Per user direction, this is the one path that must
   * fail CLOSED: a real Redis outage becomes an explicit 503 pointing at
   * the always-available manual form, the same shape `withProfileFallbackHint`
   * already gives a real OpenAI vendor outage in this exact feature — not a
   * raw, unhandled 500 or a request that hangs for the outage's duration.
   */
  private async withRedis<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (!isRedisUnavailableError(error)) throw error;
      throw new ServiceUnavailableException(
        'Conversational setup is temporarily unavailable. Try PATCH /v1/profile instead.',
      );
    }
  }

  /** FR-132/FR-135 (Open Items #3): discards any existing session for this user first. */
  async create(userId: string): Promise<ConversationalSetupSession> {
    return this.withRedis(async () => {
      const existingId = await this.client.get(ACTIVE_USER_KEY_PREFIX + userId);
      if (existingId) {
        await this.client.del(SESSION_KEY_PREFIX + existingId);
      }

      const session: ConversationalSetupSession = {
        sessionId: randomUUID(),
        userId,
        createdAt: new Date().toISOString(),
        confirmedFields: [],
        recentTurns: [],
        turnCount: 0,
      };
      await this.persist(session);
      await this.client.set(
        ACTIVE_USER_KEY_PREFIX + userId,
        session.sessionId,
        {
          EX: this.ttlSeconds(),
        },
      );
      return session;
    });
  }

  /** FR-133: caller is responsible for checking `session.userId === callerId`. */
  async get(sessionId: string): Promise<ConversationalSetupSession | null> {
    return this.withRedis(async () => {
      const raw = await this.client.get(SESSION_KEY_PREFIX + sessionId);
      return raw ? (JSON.parse(raw) as ConversationalSetupSession) : null;
    });
  }

  /** FR-134: every write refreshes the TTL — inactivity, not fixed age, drives expiry. */
  async save(session: ConversationalSetupSession): Promise<void> {
    return this.withRedis(() => this.persist(session));
  }

  private async persist(session: ConversationalSetupSession): Promise<void> {
    await this.client.set(
      SESSION_KEY_PREFIX + session.sessionId,
      JSON.stringify(session),
      { EX: this.ttlSeconds() },
    );
  }

  /** FR-135: explicit end/abandon — discards immediately, without waiting for the TTL. */
  async delete(sessionId: string, userId: string): Promise<void> {
    return this.withRedis(async () => {
      await this.client.del(SESSION_KEY_PREFIX + sessionId);
      const activeKey = ACTIVE_USER_KEY_PREFIX + userId;
      const activeId = await this.client.get(activeKey);
      if (activeId === sessionId) {
        await this.client.del(activeKey);
      }
    });
  }
}
