import { Injectable } from '@nestjs/common';
import { MessagingPermission } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdatePrivacyDto } from './dto/update-privacy.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';

export interface UserSettings {
  preciseLocationEnabled: boolean;
  messagingPermission: MessagingPermission;
  notifyOnNewMatch: boolean;
  notifyOnNewMessage: boolean;
  notifyOnSafetyAlert: boolean;
  allowInSafetyShares: boolean;
  showLastActiveStatus: boolean;
}

const SETTINGS_SELECT = {
  preciseLocationEnabled: true,
  messagingPermission: true,
  notifyOnNewMatch: true,
  notifyOnNewMessage: true,
  notifyOnSafetyAlert: true,
  allowInSafetyShares: true,
  showLastActiveStatus: true,
} as const;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** FR-80: privacy + notification settings together. */
  getSettings(userId: string): Promise<UserSettings> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: SETTINGS_SELECT,
    });
  }

  /** FR-80: partial update — either field alone, or both. */
  updatePrivacy(userId: string, dto: UpdatePrivacyDto): Promise<UserSettings> {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: SETTINGS_SELECT,
    });
  }

  /** FR-81: partial update of any subset of the three toggles — persisted only (FR-82). */
  updateNotifications(
    userId: string,
    dto: UpdateNotificationsDto,
  ): Promise<UserSettings> {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: SETTINGS_SELECT,
    });
  }
}
