import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { OtpService } from '../auth/otp/otp.service';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';
import { AccountDeletionService } from './account-deletion.service';

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let prisma: {
    user: { findUniqueOrThrow: jest.Mock; delete: jest.Mock };
    photo: { findMany: jest.Mock };
    moderationFlag: { findMany: jest.Mock };
  };
  let otpService: { verifyOtp: jest.Mock };
  let auditLog: { record: jest.Mock };
  let storage: jest.Mocked<StorageProviderInterface>;

  const dto = { phone: '+989121234567', code: '123456' };

  beforeEach(() => {
    prisma = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', phoneHash: 'hash-1' }),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      photo: { findMany: jest.fn().mockResolvedValue([]) },
      moderationFlag: { findMany: jest.fn().mockResolvedValue([]) },
    };
    otpService = { verifyOtp: jest.fn().mockResolvedValue('hash-1') };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      save: jest.fn(),
      read: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      getUrl: jest.fn(),
    };

    service = new AccountDeletionService(
      prisma as unknown as PrismaService,
      otpService as unknown as OtpService,
      auditLog as unknown as AuditLogService,
      storage,
    );
  });

  it('reuses OtpService.verifyOtp unchanged — propagates whatever it throws (FR-83)', async () => {
    otpService.verifyOtp.mockRejectedValue(new UnauthorizedException('bad'));
    await expect(service.deleteAccount('user-1', dto)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("rejects when the verified OTP's phone does not match the caller's own account", async () => {
    otpService.verifyOtp.mockResolvedValue('someone-elses-hash');
    await expect(service.deleteAccount('user-1', dto)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('deletes every photo file from storage before deleting the user row (FR-84)', async () => {
    prisma.photo.findMany.mockResolvedValue([
      { storageKey: 'key-1' },
      { storageKey: 'key-2' },
    ]);

    await service.deleteAccount('user-1', dto);

    expect(storage.delete).toHaveBeenCalledWith('key-1');
    expect(storage.delete).toHaveBeenCalledWith('key-2');
  });

  it('deletes every quarantined flagged-photo file from storage before deleting the user row (FR-101)', async () => {
    prisma.moderationFlag.findMany.mockResolvedValue([
      { quarantineStorageKey: 'flagged/key-1.webp' },
      { quarantineStorageKey: 'flagged/key-2.webp' },
    ]);

    await service.deleteAccount('user-1', dto);

    expect(prisma.moderationFlag.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', quarantineStorageKey: { not: null } },
      select: { quarantineStorageKey: true },
    });
    expect(storage.delete).toHaveBeenCalledWith('flagged/key-1.webp');
    expect(storage.delete).toHaveBeenCalledWith('flagged/key-2.webp');
  });

  it('writes an ACCOUNT_DELETION_REQUESTED audit entry before deleting the user row (FR-86)', async () => {
    const callOrder: string[] = [];
    auditLog.record.mockImplementation(() => {
      callOrder.push('audit');
      return Promise.resolve();
    });
    prisma.user.delete.mockImplementation(() => {
      callOrder.push('delete');
      return Promise.resolve();
    });

    await service.deleteAccount('user-1', dto);

    expect(auditLog.record).toHaveBeenCalledWith({
      actorId: 'user-1',
      action: 'ACCOUNT_DELETION_REQUESTED',
    });
    expect(callOrder).toEqual(['audit', 'delete']);
  });

  it('deletes the user row on success (FR-85)', async () => {
    await service.deleteAccount('user-1', dto);
    expect(prisma.user.delete).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
  });
});
