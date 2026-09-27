import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { VerifyOtpDto } from '../auth/dto/verify-otp.dto';
import { SettingsService } from './settings.service';
import { AccountDeletionService } from './account-deletion.service';
import { UpdatePrivacyDto } from './dto/update-privacy.dto';
import { UpdateNotificationsDto } from './dto/update-notifications.dto';

@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly accountDeletionService: AccountDeletionService,
  ) {}

  @Get('settings')
  @ApiOperation({
    summary: "The caller's privacy + notification settings (FR-80)",
  })
  getSettings(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.settingsService.getSettings(user.id);
  }

  @Patch('privacy')
  @ApiOperation({
    summary:
      'Update precise-location / who-can-message-me settings (FR-79, FR-80)',
  })
  updatePrivacy(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: UpdatePrivacyDto,
  ) {
    return this.settingsService.updatePrivacy(user.id, dto);
  }

  @Patch('notifications')
  @ApiOperation({
    summary:
      'Update notification preferences — persisted only, no delivery mechanism yet (FR-81, FR-82)',
  })
  updateNotifications(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: UpdateNotificationsDto,
  ) {
    return this.settingsService.updateNotifications(user.id, dto);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete the account — real, synchronous, complete purge, gated on a fresh OTP re-verification (FR-83..FR-86)',
  })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: VerifyOtpDto,
  ) {
    await this.accountDeletionService.deleteAccount(user.id, dto);
  }
}
