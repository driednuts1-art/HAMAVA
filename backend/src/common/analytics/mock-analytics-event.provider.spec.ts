import { MockAnalyticsEventProvider } from './mock-analytics-event.provider';
import { PrismaService } from '../../prisma/prisma.service';

describe('MockAnalyticsEventProvider', () => {
  it('persists a real AnalyticsEvent row (FR-151)', async () => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = {
      analyticsEvent: { create },
    } as unknown as PrismaService;
    const provider = new MockAnalyticsEventProvider(prisma);

    await provider.track('profile_completed', 'user-1', {
      source: 'CONVERSATIONAL',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        event: 'profile_completed',
        properties: { source: 'CONVERSATIONAL' },
      },
    });
  });
});
