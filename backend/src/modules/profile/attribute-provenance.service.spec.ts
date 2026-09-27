import { PrismaService } from '../../prisma/prisma.service';
import { AttributeProvenanceService } from './attribute-provenance.service';

describe('AttributeProvenanceService (FR-286..FR-289)', () => {
  let service: AttributeProvenanceService;
  let prisma: { profileAttributeProvenance: { upsert: jest.Mock } };

  beforeEach(() => {
    prisma = {
      profileAttributeProvenance: { upsert: jest.fn().mockResolvedValue({}) },
    };
    service = new AttributeProvenanceService(
      prisma as unknown as PrismaService,
    );
  });

  it('upserts on (userId, field) — latest-known-provenance, not a history row per write', async () => {
    await service.record('user-1', 'displayName', 'USER_ENTERED', null);

    expect(prisma.profileAttributeProvenance.upsert).toHaveBeenCalledWith({
      where: { userId_field: { userId: 'user-1', field: 'displayName' } },
      create: {
        userId: 'user-1',
        field: 'displayName',
        source: 'USER_ENTERED',
        confidence: null,
      },
      update: {
        source: 'USER_ENTERED',
        confidence: null,
        confirmedAt: expect.any(Date),
      },
    });
  });

  it('records a real confidence value for a USER_CONFIRMED field (FR-287)', async () => {
    await service.record('user-1', 'bio', 'USER_CONFIRMED', 0.82);

    expect(prisma.profileAttributeProvenance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          source: 'USER_CONFIRMED',
          confidence: 0.82,
        }),
      }),
    );
  });

  it('is fail-open — a write failure is swallowed, never thrown to the caller (mirrors recomputeBioEmbedding)', async () => {
    prisma.profileAttributeProvenance.upsert.mockRejectedValue(
      new Error('db hiccup'),
    );

    await expect(
      service.record('user-1', 'city', 'USER_ENTERED', null),
    ).resolves.toBeUndefined();
  });

  describe('recordMany', () => {
    it('records one row per field, all with the same source', async () => {
      await service.recordMany(
        'user-1',
        ['displayName', 'city'],
        'USER_ENTERED',
      );

      expect(prisma.profileAttributeProvenance.upsert).toHaveBeenCalledTimes(2);
    });

    it('attaches the confidence for whichever fields have one, null for the rest', async () => {
      await service.recordMany(
        'user-1',
        ['displayName', 'city'],
        'USER_CONFIRMED',
        { displayName: 0.9 },
      );

      expect(prisma.profileAttributeProvenance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            field: 'displayName',
            confidence: 0.9,
          }),
        }),
      );
      expect(prisma.profileAttributeProvenance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ field: 'city', confidence: null }),
        }),
      );
    });
  });
});
