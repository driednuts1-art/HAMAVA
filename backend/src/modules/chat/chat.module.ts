import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyModule } from '../safety/safety.module';
import { ProfileModule } from '../profile/profile.module';
import { CallsModule } from '../calls/calls.module';
import { PresenceModule } from '../presence/presence.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ConversationAccessService } from './conversation-access.service';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';

@Module({
  imports: [
    AuthModule,
    SafetyModule,
    ProfileModule,
    // forwardRef: ChatGateway's new call:signal/call:hangup handlers
    // (Feature 13) need CallService back — a genuine two-way dependency,
    // not a one-off convenience (mirrors CallsModule's own forwardRef here).
    forwardRef(() => CallsModule),
    PresenceModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    ConversationAccessService,
    ConversationService,
    MessageService,
  ],
  // ConversationAccessService exported so Feature 12's DateShareModule (and
  // now Feature 13's CallService) can reuse assertParticipant()/
  // otherParticipant() — the one existing "is this user a participant of
  // this match" check, not reimplemented. ChatGateway exported so
  // CallService can push call:incoming/call:limit-reached through it.
  exports: [ConversationAccessService, ChatGateway],
})
export class ChatModule {}
