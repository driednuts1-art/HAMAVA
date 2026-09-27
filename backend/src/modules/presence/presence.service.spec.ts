import { PresenceService } from './presence.service';
import type { RedisService } from '../../redis/redis.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { ClientOfflineError } from 'redis';

describe('PresenceService (Feature 27, FR-480..FR-486)', () => {
  let service: PresenceService;
  let redisClient: {
    sAdd: jest.Mock;
    sRem: jest.Mock;
    sCard: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    expire: jest.Mock;
    multi: jest.Mock;
  };
  let prisma: { user: { update: jest.Mock } };

  beforeEach(() => {
    redisClient = {
      sAdd: jest.fn().mockResolvedValue(1),
      sRem: jest.fn().mockResolvedValue(1),
      sCard: jest.fn().mockResolvedValue(0),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(true),
      multi: jest.fn(),
    };
    prisma = { user: { update: jest.fn().mockResolvedValue({}) } };
    service = new PresenceService(
      { client: redisClient } as unknown as RedisService,
      prisma as unknown as PrismaService,
    );
  });

  describe('recordConnect', () => {
    it('adds the socket to the user set and starts a 45s online TTL', async () => {
      await service.recordConnect('user-1', 'socket-a');
      expect(redisClient.sAdd).toHaveBeenCalledWith(
        'presence:sockets:user-1',
        'socket-a',
      );
      expect(redisClient.set).toHaveBeenCalledWith(
        'presence:online:user-1',
        '1',
        {
          EX: 45,
        },
      );
    });
  });

  describe('recordHeartbeat', () => {
    it('refreshes the online TTL without touching the sockets set', async () => {
      await service.recordHeartbeat('user-1');
      expect(redisClient.expire).toHaveBeenCalledWith(
        'presence:online:user-1',
        45,
      );
      expect(redisClient.sAdd).not.toHaveBeenCalled();
    });
  });

  describe('recordDisconnect — FR-481 multi-tab accounting', () => {
    it('does nothing further when another connection is still live (SCARD > 0)', async () => {
      redisClient.sCard.mockResolvedValue(1);

      await service.recordDisconnect('user-1', 'socket-a');

      expect(redisClient.sRem).toHaveBeenCalledWith(
        'presence:sockets:user-1',
        'socket-a',
      );
      expect(redisClient.del).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('marks offline immediately and stamps lastOnlineAt once the last connection closes (FR-482)', async () => {
      redisClient.sCard.mockResolvedValue(0);

      await service.recordDisconnect('user-1', 'socket-a');

      expect(redisClient.del).toHaveBeenCalledWith('presence:online:user-1');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { lastOnlineAt: expect.any(Date) },
      });
    });

    it('never throws if the user row is gone by the time lastOnlineAt is written (defensive only)', async () => {
      redisClient.sCard.mockResolvedValue(0);
      prisma.user.update.mockRejectedValue(new Error('Record not found'));

      await expect(
        service.recordDisconnect('user-1', 'socket-a'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getOnlineMap — FR-486 batching + FR-483 self-heal', () => {
    it('returns an empty map without calling Redis for an empty id list', async () => {
      const result = await service.getOnlineMap([]);
      expect(result.size).toBe(0);
      expect(redisClient.multi).not.toHaveBeenCalled();
    });

    it('batches one EXISTS per id in a single pipeline, never one round trip per row', async () => {
      const exec = jest.fn().mockResolvedValue([1, 0]);
      const exists = jest.fn().mockReturnThis();
      redisClient.multi.mockReturnValue({ exists, exec });
      redisClient.sCard.mockResolvedValue(0); // no stale sockets for the offline one

      const result = await service.getOnlineMap([
        'online-user',
        'offline-user',
      ]);

      expect(redisClient.multi).toHaveBeenCalledTimes(1);
      expect(exists).toHaveBeenNthCalledWith(1, 'presence:online:online-user');
      expect(exists).toHaveBeenNthCalledWith(2, 'presence:online:offline-user');
      expect(result.get('online-user')).toBe(true);
      expect(result.get('offline-user')).toBe(false);
    });

    it('self-heals a crash-orphaned sockets set for a user found offline (FR-483)', async () => {
      const exec = jest.fn().mockResolvedValue([0]);
      const exists = jest.fn().mockReturnThis();
      redisClient.multi.mockReturnValue({ exists, exec });
      // Online key already expired, but the sockets set is still stuck
      // non-empty — the exact crash-orphaned state FR-483 documents.
      redisClient.sCard.mockResolvedValue(1);

      await service.getOnlineMap(['crashed-user']);

      expect(redisClient.del).toHaveBeenCalledWith(
        'presence:sockets:crashed-user',
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'crashed-user' },
        data: { lastOnlineAt: expect.any(Date) },
      });
    });

    it('does not touch the sockets set for a genuinely, cleanly offline user (SCARD already 0)', async () => {
      const exec = jest.fn().mockResolvedValue([0]);
      const exists = jest.fn().mockReturnThis();
      redisClient.multi.mockReturnValue({ exists, exec });
      redisClient.sCard.mockResolvedValue(0);

      await service.getOnlineMap(['clean-offline-user']);

      expect(redisClient.del).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('fail-open on a real Redis outage (docs/roadmap.md) — presence is a "nice to have," never worth a request failure', () => {
    // `ClientOfflineError` is the real, live-outage case (RedisService's
    // `disableOfflineQueue: true` rejects immediately, per-command, while
    // the reconnect loop hasn't yet succeeded) — distinct from
    // `ClientClosedError` (only after a deliberate `.quit()`, e.g. app
    // shutdown), which the same catch already covered before this fix.
    it('recordConnect swallows the error instead of throwing', async () => {
      redisClient.sAdd.mockRejectedValue(new ClientOfflineError());
      await expect(
        service.recordConnect('user-1', 'socket-a'),
      ).resolves.toBeUndefined();
    });

    it('recordHeartbeat swallows the error instead of throwing', async () => {
      redisClient.expire.mockRejectedValue(new ClientOfflineError());
      await expect(service.recordHeartbeat('user-1')).resolves.toBeUndefined();
    });

    it('recordDisconnect swallows the error instead of throwing', async () => {
      redisClient.sRem.mockRejectedValue(new ClientOfflineError());
      await expect(
        service.recordDisconnect('user-1', 'socket-a'),
      ).resolves.toBeUndefined();
    });

    it('getOnlineMap — a real Redis outage during the initial pipeline never fails the whole page, every user reads as offline', async () => {
      redisClient.multi.mockImplementation(() => {
        throw new ClientOfflineError();
      });

      const result = await service.getOnlineMap(['user-1', 'user-2']);

      expect(result.get('user-1')).toBe(false);
      expect(result.get('user-2')).toBe(false);
    });

    it('getOnlineMap — a real Redis outage during the FR-483 self-heal step also fails open, not the whole request', async () => {
      const exec = jest.fn().mockResolvedValue([0]);
      const exists = jest.fn().mockReturnThis();
      redisClient.multi.mockReturnValue({ exists, exec });
      redisClient.sCard.mockRejectedValue(new ClientOfflineError());

      const result = await service.getOnlineMap(['user-1']);

      expect(result.get('user-1')).toBe(false);
    });

    it('still rethrows a genuinely unrelated error, unchanged (this is a targeted fix, not a blanket swallow)', async () => {
      redisClient.sAdd.mockRejectedValue(new Error('a real, different bug'));
      await expect(service.recordConnect('user-1', 'socket-a')).rejects.toThrow(
        'a real, different bug',
      );
    });
  });

  describe('buildPresenceField — FR-485 symmetric privacy rule', () => {
    const ONLINE_AT = new Date('2026-01-01T00:00:00Z');

    it('returns the real value when both parties allow it', () => {
      expect(service.buildPresenceField(true, true, true, ONLINE_AT)).toEqual({
        online: true,
        lastOnlineAt: ONLINE_AT,
      });
    });

    it('returns null when the viewer has turned their own toggle off, regardless of the target', () => {
      expect(
        service.buildPresenceField(false, true, true, ONLINE_AT),
      ).toBeNull();
    });

    it('returns null when the target has turned their own toggle off, regardless of the viewer', () => {
      expect(
        service.buildPresenceField(true, false, true, ONLINE_AT),
      ).toBeNull();
    });

    it('returns null when both have it off', () => {
      expect(
        service.buildPresenceField(false, false, true, ONLINE_AT),
      ).toBeNull();
    });
  });
});
