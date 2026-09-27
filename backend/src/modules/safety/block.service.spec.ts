import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from './block.service';

describe('BlockService', () => {
  let service: BlockService;
  let prisma: {
    block: {
      upsert: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      block: { upsert: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    };
    service = new BlockService(prisma as unknown as PrismaService);
  });

  it('blocking is idempotent (upsert, not a plain create)', async () => {
    prisma.block.upsert.mockResolvedValue({});
    await service.block('user-a', 'user-b');
    expect(prisma.block.upsert).toHaveBeenCalledWith({
      where: {
        blockerId_blockedId: { blockerId: 'user-a', blockedId: 'user-b' },
      },
      update: {},
      create: { blockerId: 'user-a', blockedId: 'user-b' },
    });
  });

  it('isBlocked checks both directions (FR-55, FR-64)', async () => {
    prisma.block.findFirst.mockResolvedValue(null);
    await service.isBlocked('user-a', 'user-b');
    expect(prisma.block.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { blockerId: 'user-a', blockedId: 'user-b' },
          { blockerId: 'user-b', blockedId: 'user-a' },
        ],
      },
      select: { id: true },
    });
  });

  it('returns true when a block row exists in either direction', async () => {
    prisma.block.findFirst.mockResolvedValue({ id: 'block-1' });
    await expect(service.isBlocked('user-a', 'user-b')).resolves.toBe(true);
  });

  it('returns false when no block exists', async () => {
    prisma.block.findFirst.mockResolvedValue(null);
    await expect(service.isBlocked('user-a', 'user-b')).resolves.toBe(false);
  });

  describe('hasBlocked', () => {
    it('is directional, unlike isBlocked (FR-68)', async () => {
      prisma.block.findUnique.mockResolvedValue(null);
      await service.hasBlocked('user-a', 'user-b');
      expect(prisma.block.findUnique).toHaveBeenCalledWith({
        where: {
          blockerId_blockedId: { blockerId: 'user-a', blockedId: 'user-b' },
        },
        select: { id: true },
      });
    });

    it('returns true only when that specific direction has a Block row', async () => {
      prisma.block.findUnique.mockResolvedValue({ id: 'block-1' });
      await expect(service.hasBlocked('user-a', 'user-b')).resolves.toBe(true);
    });

    it('returns false when only the reverse direction is blocked', async () => {
      prisma.block.findUnique.mockResolvedValue(null);
      await expect(service.hasBlocked('user-a', 'user-b')).resolves.toBe(false);
    });
  });
});
