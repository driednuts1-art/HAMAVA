import { ConfigService } from '@nestjs/config';
import * as redis from 'redis';
import { RedisService } from './redis.service';

const CONFIG: Record<string, string> = {
  REDIS_URL: 'redis://localhost:6379',
};

function buildConfig(): ConfigService {
  return {
    getOrThrow: (key: string) => CONFIG[key],
  } as unknown as ConfigService;
}

describe('RedisService', () => {
  let service: RedisService;
  let fakeClient: {
    on: jest.Mock;
    connect: jest.Mock;
    quit: jest.Mock;
    duplicate: jest.Mock;
  };

  beforeEach(() => {
    fakeClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      duplicate: jest.fn(),
    };
    jest.spyOn(redis, 'createClient').mockReturnValue(fakeClient as never);

    service = new RedisService(buildConfig());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects on init and exposes the connected client', async () => {
    await service.onModuleInit();

    expect(fakeClient.connect).toHaveBeenCalled();
    expect(service.client).toBe(fakeClient);
  });

  it('quits the client on destroy', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(fakeClient.quit).toHaveBeenCalled();
  });

  it('destroy is a no-op if init never ran (never connected, nothing to quit)', async () => {
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('duplicateForPubSub() returns a fresh duplicate of the shared client, not the shared client itself', async () => {
    const dupClient = { on: jest.fn(), connect: jest.fn() };
    fakeClient.duplicate.mockReturnValue(dupClient);
    await service.onModuleInit();

    const dup = service.duplicateForPubSub();

    expect(fakeClient.duplicate).toHaveBeenCalled();
    expect(dup).toBe(dupClient);
    expect(dup).not.toBe(service.client);
  });

  it('duplicateForPubSub() wires its own error logging (a pub/sub connection failure must not go silent)', async () => {
    const dupClient = { on: jest.fn(), connect: jest.fn() };
    fakeClient.duplicate.mockReturnValue(dupClient);
    await service.onModuleInit();

    service.duplicateForPubSub();

    expect(dupClient.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
});
