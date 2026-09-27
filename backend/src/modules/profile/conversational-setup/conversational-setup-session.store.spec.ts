import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ClientOfflineError } from 'redis';
import { RedisService } from '../../../redis/redis.service';
import { ConversationalSetupSessionStore } from './conversational-setup-session.store';

const CONFIG: Record<string, string | number> = {
  CONVERSATIONAL_SETUP_SESSION_TTL_MINUTES: 30,
};

function buildConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => CONFIG[key],
  } as unknown as ConfigService;
}

describe('ConversationalSetupSessionStore', () => {
  let store: ConversationalSetupSessionStore;
  let fakeClient: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
  };

  beforeEach(() => {
    fakeClient = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    const redis = { client: fakeClient } as unknown as RedisService;

    // No onModuleInit/onModuleDestroy here anymore — the shared RedisService
    // (docs/architecture.md §5.11) owns the connection lifecycle now, this
    // store just borrows its already-connected client.
    store = new ConversationalSetupSessionStore(redis, buildConfig());
  });

  it('create() persists a new session with a TTL and sets the active-user pointer (FR-132)', async () => {
    const session = await store.create('user-1');

    expect(session.userId).toBe('user-1');
    expect(session.confirmedFields).toEqual([]);
    expect(session.recentTurns).toEqual([]);
    expect(fakeClient.set).toHaveBeenCalledWith(
      `conv-setup:session:${session.sessionId}`,
      expect.any(String),
      { EX: 30 * 60 },
    );
    expect(fakeClient.set).toHaveBeenCalledWith(
      'conv-setup:active-user:user-1',
      session.sessionId,
      { EX: 30 * 60 },
    );
  });

  it('create() discards an existing session for the same user (Open Items #3, one active session per user)', async () => {
    fakeClient.get.mockResolvedValueOnce('old-session-id');

    await store.create('user-1');

    expect(fakeClient.del).toHaveBeenCalledWith(
      'conv-setup:session:old-session-id',
    );
  });

  it('get() returns null for an unknown session (FR-134: expired/unknown → 404 upstream)', async () => {
    fakeClient.get.mockResolvedValueOnce(null);
    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('get() deserializes a stored session', async () => {
    const stored = {
      sessionId: 's1',
      userId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      confirmedFields: ['displayName'],
      recentTurns: [],
      turnCount: 1,
    };
    fakeClient.get.mockResolvedValueOnce(JSON.stringify(stored));

    await expect(store.get('s1')).resolves.toEqual(stored);
  });

  it('save() refreshes the TTL on every write (FR-134)', async () => {
    const session = {
      sessionId: 's1',
      userId: 'user-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      confirmedFields: [],
      recentTurns: [],
      turnCount: 2,
    };

    await store.save(session);

    expect(fakeClient.set).toHaveBeenCalledWith(
      'conv-setup:session:s1',
      JSON.stringify(session),
      { EX: 30 * 60 },
    );
  });

  it('delete() removes the session immediately and clears the active-user pointer if it matches (FR-135)', async () => {
    fakeClient.get.mockResolvedValueOnce('s1');

    await store.delete('s1', 'user-1');

    expect(fakeClient.del).toHaveBeenCalledWith('conv-setup:session:s1');
    expect(fakeClient.del).toHaveBeenCalledWith(
      'conv-setup:active-user:user-1',
    );
  });

  it('delete() does not clear the active-user pointer if it points at a different (newer) session', async () => {
    fakeClient.get.mockResolvedValueOnce('a-newer-session');

    await store.delete('s1', 'user-1');

    expect(fakeClient.del).toHaveBeenCalledWith('conv-setup:session:s1');
    expect(fakeClient.del).not.toHaveBeenCalledWith(
      'conv-setup:active-user:user-1',
    );
  });

  describe('fail-closed on a real Redis outage (docs/roadmap.md) — unlike Presence or chat, this feature has no fallback of its own once Redis is unreachable', () => {
    it('create() surfaces a real outage as an explicit 503 pointing at the manual-form fallback, not a raw 500', async () => {
      fakeClient.get.mockRejectedValue(new ClientOfflineError());
      await expect(store.create('user-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(store.create('user-1')).rejects.toThrow(
        /PATCH \/v1\/profile/,
      );
    });

    it('get() surfaces a real outage as the same explicit 503', async () => {
      fakeClient.get.mockRejectedValue(new ClientOfflineError());
      await expect(store.get('s1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('save() surfaces a real outage as the same explicit 503', async () => {
      fakeClient.set.mockRejectedValue(new ClientOfflineError());
      await expect(
        store.save({
          sessionId: 's1',
          userId: 'user-1',
          createdAt: '2026-01-01T00:00:00.000Z',
          confirmedFields: [],
          recentTurns: [],
          turnCount: 0,
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('delete() surfaces a real outage as the same explicit 503', async () => {
      fakeClient.del.mockRejectedValue(new ClientOfflineError());
      await expect(store.delete('s1', 'user-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('still rethrows a genuinely unrelated error, unchanged (this is a targeted fix, not a blanket catch)', async () => {
      fakeClient.get.mockRejectedValue(new Error('a real, different bug'));
      await expect(store.get('s1')).rejects.toThrow('a real, different bug');
    });
  });
});
