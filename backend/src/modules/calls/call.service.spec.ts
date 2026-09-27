import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationAccessService } from '../chat/conversation-access.service';
import { ChatGateway } from '../chat/chat.gateway';
import type { TurnCredentialProviderInterface } from './turn-credential-provider.interface';
import type { AnalyticsEventProviderInterface } from '../../common/analytics/analytics-event-provider.interface';
import { CallRateLimitService } from './call-rate-limit.service';
import { CallService } from './call.service';

const CONFIG: Record<string, number> = {
  FIRST_CALL_DURATION_LIMIT_SECONDS: 300,
  CALL_RINGING_TIMEOUT_SECONDS: 60,
};

const MATCH = { id: 'match-1', userAId: 'user-1', userBId: 'user-2' };
const ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

describe('CallService', () => {
  let service: CallService;
  let prisma: {
    callSession: Record<string, jest.Mock>;
  };
  let conversationAccess: jest.Mocked<
    Pick<
      ConversationAccessService,
      'assertAccessible' | 'assertParticipant' | 'otherParticipant'
    >
  >;
  let rateLimit: jest.Mocked<CallRateLimitService>;
  let turnProvider: jest.Mocked<TurnCredentialProviderInterface>;
  let analytics: jest.Mocked<AnalyticsEventProviderInterface>;
  let chatGateway: jest.Mocked<
    Pick<ChatGateway, 'pushIncoming' | 'pushLimitReached'>
  >;

  beforeEach(() => {
    jest.useFakeTimers();
    prisma = {
      callSession: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    conversationAccess = {
      assertAccessible: jest.fn().mockResolvedValue(MATCH),
      assertParticipant: jest.fn().mockResolvedValue(MATCH),
      otherParticipant: jest.fn(
        (match: { userAId: string; userBId: string }, userId: string) =>
          match.userAId === userId ? match.userBId : match.userAId,
      ),
    };
    rateLimit = {
      enforceStart: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CallRateLimitService>;
    turnProvider = {
      generateIceServers: jest.fn().mockResolvedValue(ICE_SERVERS),
    };
    analytics = { track: jest.fn().mockResolvedValue(undefined) };
    chatGateway = { pushIncoming: jest.fn(), pushLimitReached: jest.fn() };

    const config = {
      getOrThrow: (key: string) => CONFIG[key],
      // Feature 21 (FR-300/301): assertCallTypeEnabled() reads kill switches
      // via .get(), not .getOrThrow() — undefined here means "not set,"
      // which CallService's own `!== 'false'` check correctly treats as enabled.
      get: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new CallService(
      prisma as unknown as PrismaService,
      config,
      conversationAccess as unknown as ConversationAccessService,
      rateLimit,
      turnProvider,
      analytics,
      chatGateway as unknown as ChatGateway,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('start (FR-178, FR-189, FR-190, FR-196)', () => {
    it('checks access, rate-limits, creates a RINGING session, and pushes call:incoming to the other participant', async () => {
      prisma.callSession.create.mockResolvedValue({ id: 'session-1' });

      const result = await service.start('user-1', 'match-1', 'VOICE');

      expect(conversationAccess.assertAccessible).toHaveBeenCalledWith(
        'match-1',
        'user-1',
      );
      expect(rateLimit.enforceStart).toHaveBeenCalledWith('user-1');
      expect(prisma.callSession.create).toHaveBeenCalledWith({
        data: {
          matchId: 'match-1',
          initiatorId: 'user-1',
          type: 'VOICE',
          durationLimitSeconds: 300,
        },
      });
      expect(chatGateway.pushIncoming).toHaveBeenCalledWith('user-2', {
        callSessionId: 'session-1',
        matchId: 'match-1',
        type: 'VOICE',
        fromUserId: 'user-1',
      });
      expect(result).toEqual({
        callSessionId: 'session-1',
        iceServers: ICE_SERVERS,
        durationLimitSeconds: 300,
      });
    });

    it('sets durationLimitSeconds only for the first CallSession of a match — null for a later one', async () => {
      prisma.callSession.count.mockResolvedValue(1); // a prior call already exists
      prisma.callSession.create.mockResolvedValue({ id: 'session-2' });

      const result = await service.start('user-1', 'match-1', 'VOICE');

      expect(result.durationLimitSeconds).toBeNull();
      expect(prisma.callSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationLimitSeconds: null }),
        }),
      );
    });

    it('never mints a credential or creates a session if the rate limit rejects', async () => {
      rateLimit.enforceStart.mockRejectedValue(new Error('rate limited'));
      await expect(service.start('user-1', 'match-1', 'VOICE')).rejects.toThrow(
        'rate limited',
      );
      expect(turnProvider.generateIceServers).not.toHaveBeenCalled();
      expect(prisma.callSession.create).not.toHaveBeenCalled();
    });

    it('schedules a limit-reached nudge to both participants only for a first (capped) call (FR-192)', async () => {
      prisma.callSession.create.mockResolvedValue({ id: 'session-1' });

      await service.start('user-1', 'match-1', 'VOICE');
      jest.advanceTimersByTime(300 * 1000);

      expect(chatGateway.pushLimitReached).toHaveBeenCalledWith('user-1', {
        callSessionId: 'session-1',
      });
      expect(chatGateway.pushLimitReached).toHaveBeenCalledWith('user-2', {
        callSessionId: 'session-1',
      });
    });

    it('never schedules a limit-reached nudge for an uncapped (non-first) call', async () => {
      prisma.callSession.count.mockResolvedValue(1);
      prisma.callSession.create.mockResolvedValue({ id: 'session-2' });

      await service.start('user-1', 'match-1', 'VOICE');
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(chatGateway.pushLimitReached).not.toHaveBeenCalled();
    });
  });

  describe('join (FR-179, FR-198)', () => {
    const ringingSession = {
      id: 'session-1',
      matchId: 'match-1',
      initiatorId: 'user-1',
      type: 'VOICE',
      status: 'RINGING',
      durationLimitSeconds: 300,
      createdAt: new Date(),
    };

    it("transitions RINGING to ACTIVE, mints the joiner's own credential, and fires call_started", async () => {
      prisma.callSession.findUnique.mockResolvedValue(ringingSession);

      const result = await service.join('user-2', 'match-1', 'session-1');

      expect(prisma.callSession.update).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { status: 'ACTIVE', startedAt: expect.any(Date) },
      });
      expect(result).toEqual({
        iceServers: ICE_SERVERS,
        durationLimitSeconds: 300,
      });
      expect(analytics.track).toHaveBeenCalledWith('call_started', 'user-2', {
        type: 'VOICE',
      });
    });

    it('rejects the initiator joining their own call', async () => {
      prisma.callSession.findUnique.mockResolvedValue(ringingSession);
      await expect(
        service.join('user-1', 'match-1', 'session-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.callSession.update).not.toHaveBeenCalled();
    });

    it('rejects joining a call that is no longer RINGING', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        ...ringingSession,
        status: 'ACTIVE',
      });
      await expect(
        service.join('user-2', 'match-1', 'session-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a callSessionId that does not belong to this match (404)', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        ...ringingSession,
        matchId: 'a-different-match',
      });
      await expect(
        service.join('user-2', 'match-1', 'session-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('a stale RINGING call (past CALL_RINGING_TIMEOUT_SECONDS) cannot be joined (FR-181 lazy expiry)', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        ...ringingSession,
        createdAt: new Date(Date.now() - 61_000),
      });
      prisma.callSession.update.mockResolvedValue({
        ...ringingSession,
        status: 'ENDED',
      });

      await expect(
        service.join('user-2', 'match-1', 'session-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ENDED',
            endReason: 'MISSED',
          }),
        }),
      );
    });
  });

  describe('end (FR-180)', () => {
    const activeSession = {
      id: 'session-1',
      matchId: 'match-1',
      initiatorId: 'user-1',
      type: 'VOICE',
      status: 'ACTIVE',
      startedAt: new Date(Date.now() - 30_000),
    };

    it('uses assertParticipant (not the block-aware assertAccessible) — always endable regardless of block state', async () => {
      prisma.callSession.findUnique.mockResolvedValue(activeSession);
      await service.end('user-1', 'match-1', 'session-1', {});
      expect(conversationAccess.assertParticipant).toHaveBeenCalledWith(
        'match-1',
        'user-1',
      );
      expect(conversationAccess.assertAccessible).not.toHaveBeenCalled();
    });

    it('stamps ENDED with the client-reported connectionType/qualityStatsRef, unverified', async () => {
      prisma.callSession.findUnique.mockResolvedValue(activeSession);
      await service.end('user-1', 'match-1', 'session-1', {
        connectionType: 'relayed',
        qualityStatsRef: 'stats-ref-xyz',
      });
      expect(prisma.callSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ENDED',
            connectionType: 'relayed',
            qualityStatsRef: 'stats-ref-xyz',
          }),
        }),
      );
    });

    it('fires call_ended only when the session was ACTIVE, with a computed duration', async () => {
      prisma.callSession.findUnique.mockResolvedValue(activeSession);
      await service.end('user-1', 'match-1', 'session-1', {});
      expect(analytics.track).toHaveBeenCalledWith(
        'call_ended',
        'user-1',
        expect.objectContaining({ type: 'VOICE', endReason: 'COMPLETED' }),
      );
    });

    it('never fires call_ended for a RINGING call that was never answered (no call_started ever fired)', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        ...activeSession,
        status: 'RINGING',
        startedAt: null,
      });
      await service.end('user-1', 'match-1', 'session-1', {});
      expect(analytics.track).not.toHaveBeenCalled();
    });

    it('is idempotent — ending an already-ENDED call is a no-op, not an error', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        ...activeSession,
        status: 'ENDED',
      });
      await expect(
        service.end('user-1', 'match-1', 'session-1', {}),
      ).resolves.toBeUndefined();
      expect(prisma.callSession.update).not.toHaveBeenCalled();
    });
  });

  describe('assertSignalable (FR-187)', () => {
    it('re-validates block/participant state on every call, not just at start', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        id: 'session-1',
        matchId: 'match-1',
        status: 'ACTIVE',
      });
      await service.assertSignalable('session-1', 'user-1');
      expect(conversationAccess.assertAccessible).toHaveBeenCalledWith(
        'match-1',
        'user-1',
      );
    });

    it('rejects signaling into an already-ENDED call', async () => {
      prisma.callSession.findUnique.mockResolvedValue({
        id: 'session-1',
        matchId: 'match-1',
        status: 'ENDED',
      });
      await expect(
        service.assertSignalable('session-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a nonexistent callSessionId (404)', async () => {
      prisma.callSession.findUnique.mockResolvedValue(null);
      await expect(
        service.assertSignalable('session-x', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getActive (FR-183)', () => {
    it('returns null when no RINGING/ACTIVE session exists', async () => {
      prisma.callSession.findFirst.mockResolvedValue(null);
      await expect(service.getActive('user-1', 'match-1')).resolves.toBeNull();
    });

    it('returns the current active session summary', async () => {
      prisma.callSession.findFirst.mockResolvedValue({
        id: 'session-1',
        type: 'VIDEO',
        status: 'ACTIVE',
        createdAt: new Date(),
      });
      await expect(service.getActive('user-1', 'match-1')).resolves.toEqual({
        callSessionId: 'session-1',
        type: 'VIDEO',
        status: 'ACTIVE',
      });
    });

    it('a stale RINGING session lazily expires to null (FR-181)', async () => {
      prisma.callSession.findFirst.mockResolvedValue({
        id: 'session-1',
        type: 'VOICE',
        status: 'RINGING',
        createdAt: new Date(Date.now() - 61_000),
      });
      prisma.callSession.update.mockResolvedValue({
        status: 'ENDED',
      });
      await expect(service.getActive('user-1', 'match-1')).resolves.toBeNull();
    });
  });
});
