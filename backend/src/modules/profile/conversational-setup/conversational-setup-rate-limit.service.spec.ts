import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/audit-log/audit-log.service';
import { TooManyRequestsException } from '../../../common/exceptions/too-many-requests.exception';
import { ConversationalSetupRateLimitService } from './conversational-setup-rate-limit.service';

const CONFIG: Record<string, number> = {
  CONVERSATIONAL_SETUP_SESSION_START_RATE_LIMIT_PER_HOUR: 10,
  CONVERSATIONAL_SETUP_TEXT_TURN_RATE_LIMIT_PER_MINUTE: 15,
  CONVERSATIONAL_SETUP_VOICE_TURN_RATE_LIMIT_PER_MINUTE: 5,
};

describe('ConversationalSetupRateLimitService', () => {
  let service: ConversationalSetupRateLimitService;
  let prisma: { conversationalSetupRequest: Record<string, jest.Mock> };
  let auditLog: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      conversationalSetupRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      getOrThrow: (key: string) => CONFIG[key],
    } as unknown as ConfigService;

    service = new ConversationalSetupRateLimitService(
      prisma as unknown as PrismaService,
      config,
      auditLog as unknown as AuditLogService,
    );
  });

  it('allows a request under the limit and records it', async () => {
    await service.enforce('user-1', 'TEXT_TURN');
    expect(prisma.conversationalSetupRequest.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', kind: 'TEXT_TURN' },
    });
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects once the text-turn limit is reached and audit-logs it (FR-148)', async () => {
    prisma.conversationalSetupRequest.count.mockResolvedValue(15);
    await expect(service.enforce('user-1', 'TEXT_TURN')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user-1',
        action: 'CONVERSATIONAL_SETUP_RATE_LIMIT_EXCEEDED',
        metadata: { kind: 'TEXT_TURN', limit: 15 },
      }),
    );
    expect(prisma.conversationalSetupRequest.create).not.toHaveBeenCalled();
  });

  it('rejects once the (materially stricter) voice-turn limit is reached, independently of the text count', async () => {
    prisma.conversationalSetupRequest.count.mockResolvedValue(5);
    await expect(service.enforce('user-1', 'VOICE_TURN')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(prisma.conversationalSetupRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'VOICE_TURN' }),
      }),
    );
  });

  it('enforces session starts against an independent (hourly) bucket from turns', async () => {
    prisma.conversationalSetupRequest.count.mockResolvedValue(10);
    await expect(service.enforce('user-1', 'SESSION_START')).rejects.toThrow(
      TooManyRequestsException,
    );
    expect(prisma.conversationalSetupRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kind: 'SESSION_START' }),
      }),
    );
  });

  it('does not let a high voice-turn count block a text-turn request (independent buckets)', async () => {
    prisma.conversationalSetupRequest.count.mockImplementation(
      ({ where }: { where: { kind: string } }) =>
        Promise.resolve(where.kind === 'VOICE_TURN' ? 999 : 0),
    );
    await expect(
      service.enforce('user-1', 'TEXT_TURN'),
    ).resolves.toBeUndefined();
  });
});
