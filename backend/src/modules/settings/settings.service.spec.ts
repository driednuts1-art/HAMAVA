import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      user: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    };
    service = new SettingsService(prisma as unknown as PrismaService);
  });

  describe('getSettings', () => {
    it('selects only the privacy + notification fields (FR-80)', async () => {
      const settings = {
        preciseLocationEnabled: false,
        messagingPermission: 'VERIFIED_ONLY',
        notifyOnNewMatch: true,
        notifyOnNewMessage: true,
        notifyOnSafetyAlert: true,
        allowInSafetyShares: true,
        showLastActiveStatus: true,
      };
      prisma.user.findUniqueOrThrow.mockResolvedValue(settings);

      await expect(service.getSettings('user-1')).resolves.toEqual(settings);
      expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          preciseLocationEnabled: true,
          messagingPermission: true,
          notifyOnNewMatch: true,
          notifyOnNewMessage: true,
          notifyOnSafetyAlert: true,
          allowInSafetyShares: true,
          showLastActiveStatus: true,
        },
      });
    });
  });

  describe('updatePrivacy', () => {
    it('passes through a partial update (FR-80)', async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updatePrivacy('user-1', { preciseLocationEnabled: true });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { preciseLocationEnabled: true },
        }),
      );
    });

    it('passes through allowInSafetyShares (Feature 12, FR-171/FR-172)', async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updatePrivacy('user-1', { allowInSafetyShares: false });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { allowInSafetyShares: false },
        }),
      );
    });
  });

  describe('updateNotifications', () => {
    it('passes through a partial update of any subset (FR-81)', async () => {
      prisma.user.update.mockResolvedValue({});
      await service.updateNotifications('user-1', {
        notifyOnNewMessage: false,
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: { notifyOnNewMessage: false },
        }),
      );
    });
  });
});
