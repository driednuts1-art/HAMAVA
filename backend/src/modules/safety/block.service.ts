import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BlockService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent — blocking someone twice is a no-op, not an error. */
  async block(blockerId: string, blockedId: string): Promise<void> {
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      update: {},
      create: { blockerId, blockedId },
    });
  }

  /** FR-55, FR-64: bidirectional — either side having blocked the other counts. */
  async isBlocked(userA: string, userB: string): Promise<boolean> {
    const block = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
      select: { id: true },
    });
    return block !== null;
  }

  /**
   * FR-68: directional, unlike isBlocked() — did `blockerId` specifically
   * block `blockedId`. Used wherever a block's effect must apply only to the
   * blocking side (chat access, conversation listing), not the blocked party.
   */
  async hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const block = await this.prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      select: { id: true },
    });
    return block !== null;
  }
}
