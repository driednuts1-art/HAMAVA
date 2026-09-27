import { PrismaService } from '../../prisma/prisma.service';
import { AiUsageTrackerService } from './ai-usage-tracker.service';

describe('AiUsageTrackerService (FR-298/FR-299)', () => {
  let service: AiUsageTrackerService;
  let prisma: { aiUsageEvent: { create: jest.Mock } };

  beforeEach(() => {
    prisma = { aiUsageEvent: { create: jest.fn().mockResolvedValue({}) } };
    service = new AiUsageTrackerService(prisma as unknown as PrismaService);
  });

  it('records a real success event with a real, computed cost estimate for a known model', async () => {
    await service.record({
      provider: 'openai',
      model: 'gpt-4o-mini',
      feature: 'ai-search-extraction',
      success: true,
      latencyMs: 842,
      promptTokens: 1000,
      completionTokens: 200,
    });

    expect(prisma.aiUsageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'ai-search-extraction',
        success: true,
        latencyMs: 842,
        promptTokens: 1000,
        completionTokens: 200,
        // 1000/1000 * 0.00015 + 200/1000 * 0.0006 = 0.00015 + 0.00012 = 0.00027
        estimatedCostUsd: expect.closeTo(0.00027, 8),
      }),
    });
  });

  it('leaves estimatedCostUsd undefined for an unknown model, rather than guessing', async () => {
    await service.record({
      provider: 'openai',
      model: 'some-future-model',
      feature: 'ai-search-extraction',
      success: true,
      latencyMs: 100,
      promptTokens: 500,
    });

    const data = prisma.aiUsageEvent.create.mock.calls[0][0].data;
    expect(data.estimatedCostUsd).toBeUndefined();
  });

  it('leaves estimatedCostUsd undefined when no token counts are available (e.g. transcription, moderation)', async () => {
    await service.record({
      provider: 'openai',
      model: 'whisper-1',
      feature: 'transcription',
      success: true,
      latencyMs: 3000,
    });

    const data = prisma.aiUsageEvent.create.mock.calls[0][0].data;
    expect(data.estimatedCostUsd).toBeUndefined();
  });

  it('records a real failure event too — success:false is a normal, expected write, not skipped', async () => {
    await service.record({
      provider: 'openai',
      model: 'gpt-4o-mini',
      feature: 'ai-search-extraction',
      success: false,
      latencyMs: 15000,
    });

    expect(prisma.aiUsageEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false }),
      }),
    );
  });

  it('never includes prompt/completion content — only the documented metadata fields (FR-299)', async () => {
    await service.record({
      provider: 'openai',
      model: 'gpt-4o-mini',
      feature: 'conversational-extraction',
      success: true,
      latencyMs: 500,
      promptTokens: 10,
      completionTokens: 5,
    });

    const data = prisma.aiUsageEvent.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(Object.keys(data).sort()).toEqual(
      [
        'userId',
        'provider',
        'model',
        'feature',
        'success',
        'latencyMs',
        'promptTokens',
        'completionTokens',
        'estimatedCostUsd',
      ].sort(),
    );
  });

  it('is fail-open — a write failure is swallowed, never thrown to the caller', async () => {
    prisma.aiUsageEvent.create.mockRejectedValue(new Error('db hiccup'));

    await expect(
      service.record({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'embedding',
        success: true,
        latencyMs: 100,
      }),
    ).resolves.toBeUndefined();
  });
});
