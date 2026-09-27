import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/audit-log/audit-log.service';
import { OtpService } from '../auth/otp/otp.service';
import { VerifyOtpDto } from '../auth/dto/verify-otp.dto';
import { STORAGE_PROVIDER } from '../profile/storage/storage-provider.interface';
import type { StorageProviderInterface } from '../profile/storage/storage-provider.interface';

@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
    private readonly auditLog: AuditLogService,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProviderInterface,
  ) {}

  /**
   * FR-83..FR-86: a real, synchronous, complete purge, gated on a freshly
   * verified OTP for the caller's own phone — not just the access token
   * already required to reach this endpoint (docs/requirements.md Feature 6
   * Open Items #1: a stolen JWT alone must not be enough).
   */
  async deleteAccount(userId: string, dto: VerifyOtpDto): Promise<void> {
    const caller = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    // Reuses OtpService.verifyOtp() unchanged — the exact same check
    // /v1/auth/otp/verify already performs, no parallel logic. Throws
    // UnauthorizedException on a missing/wrong/expired/over-attempted code.
    const verifiedPhoneHash = await this.otpService.verifyOtp(
      dto.phone,
      dto.code,
    );

    // The verified OTP must belong to *this* caller's own phone — otherwise
    // a valid OTP for someone else's number could delete a different account.
    if (verifiedPhoneHash !== caller.phoneHash) {
      throw new UnauthorizedException('OTP does not match your account.');
    }

    // FR-84: Prisma's cascade deletes the Photo rows but never the files —
    // the same real-file-deletion mechanism ProfileService.deletePhoto() uses.
    const photos = await this.prisma.photo.findMany({ where: { userId } });
    await Promise.all(
      photos.map((photo) => this.storage.delete(photo.storageKey)),
    );

    // FR-101 (Feature 8): the second place a user's image bytes can live —
    // a flagged photo's quarantined bytes, same reasoning as the Photo loop
    // above. ModerationFlag rows themselves cascade with the User row below.
    const flaggedPhotos = await this.prisma.moderationFlag.findMany({
      where: { userId, quarantineStorageKey: { not: null } },
      select: { quarantineStorageKey: true },
    });
    await Promise.all(
      flaggedPhotos.map((flag) =>
        this.storage.delete(flag.quarantineStorageKey!),
      ),
    );

    // FR-86: written before the row disappears. AuditLog has no foreign key
    // to User by design (docs/architecture.md) — this row, and every prior
    // row naming this user as actorId/targetRef, survives the deletion below.
    await this.auditLog.record({
      actorId: userId,
      action: 'ACCOUNT_DELETION_REQUESTED',
    });

    // FR-85, FR-101: cascades through every already onDelete:Cascade foreign
    // key — Session, ConsentRecord, LivenessSession, Photo,
    // DiscoveryPreferences, Swipe, Match, Message, Block, Report
    // (reporter/reported sides), ModerationFlag. No application code
    // duplicates what the schema already guarantees.
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
