import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Request an OTP for a phone number (rate-limited, FR-1..FR-4, FR-6)',
  })
  async requestOtp(@Body() dto: RequestOtpDto, @Req() req: Request) {
    const { devCode } = await this.authService.requestOtp(
      dto.phone,
      req.ip ?? 'unknown',
    );
    return {
      message: 'If the number is valid, an OTP has been sent.',
      ...(devCode ? { devCode } : {}),
    };
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Verify an OTP and receive an access + refresh token (FR-3, FR-5, FR-7)',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto, @Req() req: Request) {
    const result = await this.authService.verifyOtp(
      dto.phone,
      dto.code,
      req.headers['user-agent'],
    );
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: { id: result.userId, livenessStatus: result.livenessStatus },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Rotate a refresh token for a new access + refresh token pair (FR-8..FR-10)',
  })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      req.headers['user-agent'],
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token / session' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }
}
