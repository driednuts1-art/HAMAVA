import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockService } from './block.service';
import { ReportService } from './report.service';
import { ReportReasonDto } from './dto/report-reason.dto';

/**
 * FR-71: block/report a user directly, without requiring an existing match.
 * Thin orchestration only — the actual writes stay in BlockService/
 * ReportService, the same ones the chat-scoped routes use, so there's no
 * duplicated logic between the two entry points.
 */
@Injectable()
export class UserSafetyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockService: BlockService,
    private readonly reportService: ReportService,
  ) {}

  private async assertValidTarget(
    callerId: string,
    targetUserId: string,
  ): Promise<void> {
    if (callerId === targetUserId) {
      throw new BadRequestException('Cannot target yourself.');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('User not found.');
    }
  }

  async block(callerId: string, targetUserId: string): Promise<void> {
    await this.assertValidTarget(callerId, targetUserId);
    await this.blockService.block(callerId, targetUserId);
  }

  async report(callerId: string, targetUserId: string, dto: ReportReasonDto) {
    await this.assertValidTarget(callerId, targetUserId);
    return this.reportService.create(
      callerId,
      targetUserId,
      dto.category,
      dto.reason,
    );
  }
}
