import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ProfileService } from './profile.service';
import { PROMPTS } from './prompts.constants';

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @ApiOperation({ summary: "Read the caller's own profile" })
  getMyProfile(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.profileService.getProfile(user.id);
  }

  // FR-433 (Feature 24): the one real source of truth both this endpoint and
  // UpdateProfileDto's own promptId validation read from — never a second,
  // hardcoded frontend copy that could silently drift.
  @Get('prompts')
  @ApiOperation({
    summary: 'The fixed list of real personality prompts (FR-433)',
  })
  getPrompts() {
    return PROMPTS;
  }

  @Patch()
  @ApiOperation({
    summary: "Partially update the caller's own profile fields (FR-19..FR-24)",
  })
  updateProfile(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.updateProfile(user.id, dto);
  }

  @Post('photos')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a profile photo (FR-25..FR-31)' })
  @UseInterceptors(FileInterceptor('photo'))
  uploadPhoto(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.profileService.uploadPhoto(user.id, file);
  }

  @Delete('photos/:id')
  @ApiOperation({ summary: "Delete one of the caller's own photos (FR-32)" })
  deletePhoto(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('id') id: string,
  ) {
    return this.profileService.deletePhoto(user.id, id);
  }

  // Feature 29 (FR-503): modeled directly on
  // who-liked-me.controller.ts's own POST .../seen — no DTO, current user only.
  @Post('welcome-tour/seen')
  @ApiOperation({
    summary: 'Mark the one-time welcome tour as seen for good (FR-503)',
  })
  async markWelcomeTourSeen(@CurrentUser() user: AuthenticatedRequest['user']) {
    await this.profileService.markWelcomeTourSeen(user.id);
    return { ok: true };
  }
}
