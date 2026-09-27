import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LivenessCallbackDto } from './dto/liveness-callback.dto';
import { VerificationService } from './verification.service';

@ApiTags('verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('verification/liveness')
export class LivenessController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('session')
  @ApiOperation({
    summary: 'Start a liveness challenge session (FR-13..FR-15)',
  })
  startSession(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.verificationService.startLivenessSession(user.id);
  }

  @Post('callback')
  @ApiOperation({
    summary:
      'Provider result callback (webhook shape, for a future real async vendor — the mock provider resolves synchronously and does not call this)',
  })
  handleCallback(@Body() dto: LivenessCallbackDto) {
    return this.verificationService.applyResult(
      dto.providerSessionRef,
      dto.result,
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Read the current liveness verification status' })
  getStatus(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.verificationService.getStatus(user.id);
  }
}
