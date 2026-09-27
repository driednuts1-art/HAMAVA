import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { CallController } from './call.controller';
import { CallService } from './call.service';
import { CallRateLimitService } from './call-rate-limit.service';
import { TURN_CREDENTIAL_PROVIDER } from './turn-credential-provider.interface';
import { CloudflareTurnCredentialProvider } from './cloudflare-turn-credential.provider';

@Module({
  imports: [
    AuthModule,
    // ConversationAccessService (FR-189's reused access check) and
    // ChatGateway (FR-185..FR-188's signaling relay) both come from here.
    // forwardRef: ChatModule needs CallService back (for the new
    // call:signal/call:hangup handlers), so this is a genuine two-way
    // dependency between the two modules, not a one-off convenience.
    forwardRef(() => ChatModule),
  ],
  controllers: [CallController],
  providers: [
    CallService,
    CallRateLimitService,
    // Real provider — Cloudflare Realtime TURN (docs/requirements.md Feature 13).
    {
      provide: TURN_CREDENTIAL_PROVIDER,
      useClass: CloudflareTurnCredentialProvider,
    },
  ],
  // CallService exported so ChatGateway (in ChatModule) can validate
  // call:signal/call:hangup senders against real CallSession state.
  exports: [CallService],
})
export class CallsModule {}
