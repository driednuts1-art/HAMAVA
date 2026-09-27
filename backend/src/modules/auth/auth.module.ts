import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MockOtpProvider } from './otp/mock-otp.provider';
import { OTP_PROVIDER } from './otp/otp-provider.interface';
import { OtpService } from './otp/otp.service';
import { TokenService } from './tokens/token.service';

@Module({
  imports: [JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtAuthGuard,
    // MOCK provider — see docs/roadmap.md §1 for the real-vendor swap plan.
    { provide: OTP_PROVIDER, useClass: MockOtpProvider },
  ],
  // OTP_PROVIDER is exported so ProductionSafetyService can check it's not a mock.
  // OtpService is exported so SettingsModule can reuse verifyOtp() for account
  // deletion's re-authentication step (Feature 6 FR-83) without duplicating it.
  // UsersModule is re-exported (Feature 20) because JwtAuthGuard now needs
  // UsersService itself (the real-existence check, see the guard's own
  // header comment) — Nest doesn't transitively forward an imported
  // module's providers to a module's own consumers, so every module that
  // imports AuthModule for JwtAuthGuard needs this to resolve it too. Found
  // by a real e2e boot failure (AdminModule couldn't resolve UsersService),
  // not anticipated in advance.
  exports: [TokenService, JwtAuthGuard, OTP_PROVIDER, OtpService, UsersModule],
})
export class AuthModule {}
