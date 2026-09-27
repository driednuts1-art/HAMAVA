import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../../common/exceptions/too-many-requests.exception';
import { AiSearchRateLimitService } from './ai-search-rate-limit.service';

const CONFIG: Record<string, number> = {
  AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE: 10,
  AI_SEARCH_VOICE_RATE_LIMIT_PER_MINUTE: 3,
};

describe('AiSearchRateLimitService', () => {
  let service: AiSearchRateLimitService;
  let prisma: { aiSearchRequest: Record<string, jest.Mock> };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      aiSearchRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new AiSearchRateLimitService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
    );
  });

  it('allows a request under the text limit and records it', async () => {
    await service.enforce('user-1', 'TEXT');
    expect(prisma.aiSearchRequest.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', mode: 'TEXT' },
    });
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects once the text limit is reached and audit-logs it (FR-115)', async () => {
    prisma.aiSearchRequest.count.mockResolvedValue(10);
    await expect(service.enforce('user-1', 'TEXT')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'AI_SEARCH_RATE_LIMIT_EXCEEDED',
        metadata: { mode: 'TEXT', limit: 10 },
      }),
    );
    expect(prisma.aiSearchRequest.create).not.toHaveBeenCalled();
  });

  it('rejects once the (materially stricter) voice limit is reached, independently of the text count', async () => {
    prisma.aiSearchRequest.count.mockResolvedValue(3);
    await expect(service.enforce('user-1', 'VOICE')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(prisma.aiSearchRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mode: 'VOICE' }),
      }),
    );
  });

  it('does not let a high voice count block a text request (independent buckets)', async () => {
    prisma.aiSearchRequest.count.mockImplementation(
      ({ where }: { where: { mode: string } }) =>
        Promise.resolve(where.mode === 'VOICE' ? 999 : 0),
    );
    await expect(service.enforce('user-1', 'TEXT')).resolves.toBeUndefined();
  });
});
