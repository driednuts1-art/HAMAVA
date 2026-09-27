import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallEndReason, CallSession, CallType, Match } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationAccessService } from '../chat/conversation-access.service';
import { ChatGateway } from '../chat/chat.gateway';
import { TURN_CREDENTIAL_PROVIDER } from './turn-credential-provider.interface';
import type {
  IceServer,
  TurnCredentialProviderInterface,
} from './turn-credential-provider.interface';
import { CallRateLimitService } from './call-rate-limit.service';
import { ANALYTICS_EVENT_PROVIDER } from '../../common/analytics/analytics-event-provider.interface';
import type { AnalyticsEventProviderInterface } from '../../common/analytics/analytics-event-provider.interface';
import { EndCallDto } from './dto/end-call.dto';

export interface StartCallResult {
  callSessionId: string;
  iceServers: IceServer[];
  durationLimitSeconds: number | null;
}

export interface JoinCallResult {
  iceServers: IceServer[];
  durationLimitSeconds: number | null;
}

/**
 * FR-178..FR-198: CallSession lifecycle. Every access check reuses Feature
 * 4/5's existing services (FR-189) — nothing here reimplements
 * "is this a real, non-blocked match."
 */
@Injectable()
export class CallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly conversationAccess: ConversationAccessService,
    private readonly rateLimit: CallRateLimitService,
    @Inject(TURN_CREDENTIAL_PROVIDER)
    private readonly turnProvider: TurnCredentialProviderInterface,
    @Inject(ANALYTICS_EVENT_PROVIDER)
    private readonly analytics: AnalyticsEventProviderInterface,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  /** FR-178. */
  async start(
    userId: string,
    matchId: string,
    type: CallType,
  ): Promise<StartCallResult> {
    this.assertCallTypeEnabled(type); // FR-300/301 (Feature 21)
    const match = await this.conversationAccess.assertAccessible(
      matchId,
      userId,
    ); // FR-189
    await this.rateLimit.enforceStart(userId); // FR-196

    const isFirst =
      (await this.prisma.callSession.count({ where: { matchId } })) === 0;
    const durationLimitSeconds = isFirst
      ? this.config.getOrThrow<number>('FIRST_CALL_DURATION_LIMIT_SECONDS') // FR-190
      : null;

    const iceServers = await this.turnProvider.generateIceServers(); // FR-174..FR-176

    const session = await this.prisma.callSession.create({
      data: { matchId, initiatorId: userId, type, durationLimitSeconds },
    });

    const otherId = this.conversationAccess.otherParticipant(match, userId);
    this.chatGateway.pushIncoming(otherId, {
      callSessionId: session.id,
      matchId,
      type,
      fromUserId: userId,
    }); // FR-186

    if (durationLimitSeconds) {
      this.scheduleLimitNudge(
        session.id,
        [userId, otherId],
        durationLimitSeconds,
      ); // FR-192
    }

    return { callSessionId: session.id, iceServers, durationLimitSeconds };
  }

  /** FR-179. */
  async join(
    userId: string,
    matchId: string,
    callSessionId: string,
  ): Promise<JoinCallResult> {
    await this.conversationAccess.assertAccessible(matchId, userId); // FR-189
    const session = await this.loadOwned(callSessionId, matchId);

    if (session.initiatorId === userId) {
      throw new ConflictException('Cannot join a call you started.');
    }
    const fresh = await this.expireIfStale(session);
    if (fresh.status !== 'RINGING') {
      throw new ConflictException('This call is no longer ringing.');
    }

    const iceServers = await this.turnProvider.generateIceServers();
    await this.prisma.callSession.update({
      where: { id: callSessionId },
      data: { status: 'ACTIVE', startedAt: new Date() },
    });

    // FR-198: call_started fires only once a call actually connects, not on
    // FR-178's start alone.
    await this.trackFailOpen('call_started', userId, {
      type: fresh.type,
    });

    return { iceServers, durationLimitSeconds: fresh.durationLimitSeconds };
  }

  /**
   * FR-180. Uses `assertParticipant` (not the block-aware `assertAccessible`)
   * deliberately — a call must always be endable by either party, even if a
   * block happened mid-call, the same "always reachable" instinct FR-65
   * already established for report/block themselves.
   */
  async end(
    userId: string,
    matchId: string,
    callSessionId: string,
    dto: EndCallDto,
    endReason: CallEndReason = 'COMPLETED',
  ): Promise<void> {
    await this.conversationAccess.assertParticipant(matchId, userId);
    const session = await this.loadOwned(callSessionId, matchId);
    if (session.status === 'ENDED') return; // idempotent — already ended

    await this.prisma.callSession.update({
      where: { id: callSessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        endReason,
        connectionType: dto.connectionType,
        qualityStatsRef: dto.qualityStatsRef,
      },
    });

    if (session.status === 'ACTIVE') {
      await this.trackFailOpen('call_ended', userId, {
        type: session.type,
        durationSeconds: session.startedAt
          ? Math.round((Date.now() - session.startedAt.getTime()) / 1000)
          : null,
        endReason,
      });
    }
  }

  /** FR-183. */
  async getActive(
    userId: string,
    matchId: string,
  ): Promise<{
    callSessionId: string;
    type: CallType;
    status: string;
  } | null> {
    await this.conversationAccess.assertAccessible(matchId, userId);
    const session = await this.prisma.callSession.findFirst({
      where: { matchId, status: { in: ['RINGING', 'ACTIVE'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!session) return null;
    const fresh = await this.expireIfStale(session);
    if (fresh.status === 'ENDED') return null;
    return {
      callSessionId: fresh.id,
      type: fresh.type,
      status: fresh.status,
    };
  }

  /**
   * FR-187: re-validated on every single signal, not just at call start — a
   * call that was legitimate when it started but where one party got
   * blocked mid-call must not be able to keep signaling.
   */
  async assertSignalable(
    callSessionId: string,
    userId: string,
  ): Promise<{ session: CallSession; match: Match; otherId: string }> {
    const session = await this.prisma.callSession.findUnique({
      where: { id: callSessionId },
    });
    if (!session) throw new NotFoundException('Call session not found.');
    const match = await this.conversationAccess.assertAccessible(
      session.matchId,
      userId,
    );
    if (session.status === 'ENDED') {
      throw new ConflictException('This call has already ended.');
    }
    const otherId = this.conversationAccess.otherParticipant(match, userId);
    return { session, match, otherId };
  }

  /**
   * FR-300/301 (Feature 21): checked here, not a route-level guard — the
   * relevant kill switch depends on the request body's `type`, which a
   * generic guard can't cleanly branch on without reading the unvalidated
   * body directly.
   */
  private assertCallTypeEnabled(type: CallType): void {
    const envVarName =
      type === 'VOICE' ? 'VOICE_CALLS_ENABLED' : 'VIDEO_CALLS_ENABLED';
    const enabled = this.config.get<string>(envVarName) !== 'false';
    if (!enabled) {
      const label = type === 'VOICE' ? 'Voice calls' : 'Video calls';
      throw new ServiceUnavailableException(
        `${label} are temporarily disabled.`,
      );
    }
  }

  private async loadOwned(
    callSessionId: string,
    matchId: string,
  ): Promise<CallSession> {
    const session = await this.prisma.callSession.findUnique({
      where: { id: callSessionId },
    });
    if (!session || session.matchId !== matchId) {
      throw new NotFoundException('Call session not found.');
    }
    return session;
  }

  /** FR-181/Open Items #4: lazy expiry — a stale RINGING call reads as MISSED. */
  private async expireIfStale(session: CallSession): Promise<CallSession> {
    if (session.status !== 'RINGING') return session;
    const timeoutSeconds = this.config.getOrThrow<number>(
      'CALL_RINGING_TIMEOUT_SECONDS',
    );
    const staleSince = Date.now() - session.createdAt.getTime();
    if (staleSince < timeoutSeconds * 1000) return session;

    return this.prisma.callSession.update({
      where: { id: session.id },
      data: { status: 'ENDED', endedAt: new Date(), endReason: 'MISSED' },
    });
  }

  /**
   * FR-192: a UX-only signaling nudge, not a security control (Open Items
   * #3) — the backend has no media-path control and cannot force either
   * WebRTC peer to actually hang up; real enforcement is the client
   * application's responsibility. A plain in-process timer, not a
   * persisted/distributed job: acceptable because a missed nudge (e.g. on a
   * server restart, or on a different instance than the one handling this
   * call under horizontal scaling) only degrades a UX hint, never a
   * guarantee — see docs/architecture.md's Feature 13 section.
   */
  private scheduleLimitNudge(
    callSessionId: string,
    userIds: string[],
    delaySeconds: number,
  ): void {
    setTimeout(() => {
      for (const userId of userIds) {
        this.chatGateway.pushLimitReached(userId, { callSessionId });
      }
    }, delaySeconds * 1000).unref();
  }

  /** FR-198: fail-open — an analytics-write hiccup must never affect a real call. */
  private async trackFailOpen(
    event: string,
    userId: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.analytics.track(event, userId, properties);
    } catch {
      // Deliberately swallowed — see ProfileService.maybeMarkProfileCompleted
      // for the identical precedent and reasoning.
    }
  }
}
