import {
  Body,
  Controller,
  Delete,
  Param,
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
} from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ConversationalSetupMessageDto } from './dto/conversational-setup-message.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { ConversationalSetupService } from './conversational-setup.service';
import { FeatureEnabledGuard } from '../../../common/feature-flags/feature-enabled.guard';

@ApiTags('profile')
@ApiBearerAuth()
@UseGuards(
  JwtAuthGuard,
  FeatureEnabledGuard('AI_ONBOARDING_ENABLED', 'Conversational profile setup'),
)
@Controller('profile/conversational-setup')
export class ConversationalSetupController {
  constructor(private readonly setup: ConversationalSetupService) {}

  @Post('start')
  @ApiOperation({
    summary: 'Begin a new conversational profile-setup session (FR-132)',
  })
  start(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.setup.start(user.id);
  }

  @Post(':sessionId/message')
  @ApiOperation({
    summary:
      'Submit a text turn — proposes a field, never saves it (FR-136, FR-140)',
  })
  submitText(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('sessionId') sessionId: string,
    @Body() dto: ConversationalSetupMessageDto,
  ) {
    return this.setup.submitText(user.id, sessionId, dto.text);
  }

  @Post(':sessionId/voice')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Submit a voice turn — transcribes then proposes a field, never saves it (FR-137, FR-140)',
  })
  @UseInterceptors(FileInterceptor('audio'))
  submitVoice(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.setup.submitVoice(
      user.id,
      sessionId,
      file.buffer,
      file.originalname,
      file.mimetype,
    );
  }

  @Post(':sessionId/confirm')
  @ApiOperation({
    summary:
      'Confirm (or edit) exactly one proposed field — the only path that writes to the real profile (FR-141)',
  })
  confirm(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.setup.confirm(user.id, sessionId, dto);
  }

  @Delete(':sessionId')
  @ApiOperation({
    summary:
      'End the session immediately, without waiting for its TTL (FR-135)',
  })
  end(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('sessionId') sessionId: string,
  ) {
    return this.setup.end(user.id, sessionId);
  }
}
