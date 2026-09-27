import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PreferencesService } from './preferences.service';

describe('PreferencesService', () => {
  let service: PreferencesService;
  let prisma: {
    discoveryPreferences: { findUnique: jest.Mock; upsert: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      discoveryPreferences: { findUnique: jest.fn(), upsert: jest.fn() },
    };
    service = new PreferencesService(prisma as unknown as PrismaService);
  });

  describe('getEffective', () => {
    it('defaults to verifiedOnly=true when no row has ever been saved (FR-47)', async () => {
      prisma.discoveryPreferences.findUnique.mockResolvedValue(null);
      const prefs = await service.getEffective('user-1');
      expect(prefs.verifiedOnly).toBe(true);
      expect(prefs.minAge).toBe(18);
      expect(prefs.maxAge).toBe(100);
    });

    it('returns the saved row when one exists', async () => {
      prisma.discoveryPreferences.findUnique.mockResolvedValue({
        verifiedOnly: false,
        minAge: 25,
        maxAge: 40,
      });
      const prefs = await service.getEffective('user-1');
      expect(prefs.verifiedOnly).toBe(false);
    });

    // Regression test: a real bug found via direct browser reproduction
    // (docs/requirements.md Feature 16 §12 — "apply filters" produced a
    // real 400, "property userId should not exist; property updatedAt
    // should not exist"). A bare findUnique() returns the *full* Prisma row
    // once a real row exists — userId/updatedAt included — which the
    // frontend's filters panel then echoed straight back into its own
    // PATCH. A mock can't simulate Prisma's own `select` actually
    // narrowing what comes back (that's covered for real by the e2e test
    // below), so this asserts the one thing a unit test *can* prove: this
    // service now always requests exactly the 7 allowed fields, never a
    // bare, unscoped findUnique() that could leak whatever the row has.
    it('requests findUnique with an explicit select — never a bare query that could leak userId/updatedAt', async () => {
      prisma.discoveryPreferences.findUnique.mockResolvedValue(null);
      await service.getEffective('user-1');
      expect(prisma.discoveryPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: {
          minAge: true,
          maxAge: true,
          genderPref: true,
          relationshipGoalPref: true,
          verifiedOnly: true,
          activeThisWeekOnly: true,
          newMembersOnly: true,
        },
      });
    });
  });

  describe('update', () => {
    it('rejects minAge > maxAge', async () => {
      prisma.discoveryPreferences.findUnique.mockResolvedValue(null);
      await expect(
        service.update('user-1', { minAge: 50, maxAge: 30 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.discoveryPreferences.upsert).not.toHaveBeenCalled();
    });

    it('accepts a partial update against the existing minAge/maxAge', async () => {
      prisma.discoveryPreferences.findUnique.mockResolvedValue({
        minAge: 20,
        maxAge: 40,
      });
      prisma.discoveryPreferences.upsert.mockResolvedValue({});
      await service.update('user-1', { maxAge: 35 });
      expect(prisma.discoveryPreferences.upsert).toHaveBeenCalled();
    });

    it('upserts on first save with the schema defaults filled in', async () => {
      prisma.discoveryPreferences.findUnique.mockResolvedValue(null);
      prisma.discoveryPreferences.upsert.mockResolvedValue({});
      await service.update('user-1', { verifiedOnly: false });
      expect(prisma.discoveryPreferences.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          create: expect.objectContaining({
            userId: 'user-1',
            verifiedOnly: false,
            minAge: 18,
          }),
        }),
      );
    });
  });
});
