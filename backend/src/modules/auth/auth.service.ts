import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { OtpService } from './otp/otp.service';
import { IssuedTokens, TokenService } from './tokens/token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly otpService: OtpService,
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  requestOtp(phone: string, ip: string): Promise<{ devCode?: string }> {
    return this.otpService.requestOtp(phone, ip);
  }

  async verifyOtp(
    phone: string,
    code: string,
    deviceInfo?: string,
  ): Promise<IssuedTokens & { userId: string; livenessStatus: boolean }> {
    const phoneHash = await this.otpService.verifyOtp(phone, code);
    const user = await this.usersService.findOrCreateByPhoneHash(phoneHash);
    const tokens = await this.tokenService.issueTokens(user.id, deviceInfo);

    return { ...tokens, userId: user.id, livenessStatus: user.livenessStatus };
  }

  refresh(refreshToken: string, deviceInfo?: string): Promise<IssuedTokens> {
    return this.tokenService.rotateRefreshToken(refreshToken, deviceInfo);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokenService.revokeRefreshToken(refreshToken);
  }
}
