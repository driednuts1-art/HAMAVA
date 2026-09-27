import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AcceptConsentDto } from './dto/accept-consent.dto';
import { VerificationService } from './verification.service';

@ApiTags('consent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consent')
export class ConsentController {
  constructor(private readonly verificationService: VerificationService) {}

  @Post('biometric')
  @ApiOperation({
    summary:
      'Record timestamped, versioned biometric-capture consent (FR-11, FR-12)',
  })
  acceptBiometricConsent(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: AcceptConsentDto,
  ) {
    return this.verificationService.acceptConsent(user.id, dto.policyVersion);
  }
}
