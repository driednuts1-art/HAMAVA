import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessageHistoryQueryDto } from './dto/message-history-query.dto';
import { ReportConversationDto } from './dto/report-conversation.dto';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat/conversations')
export class ChatController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
  ) {}

  @Get()
  @ApiOperation({
    summary: "The caller's conversations (one per match), most recent first",
  })
  listConversations(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.conversationService.listConversations(user.id);
  }

  @Get(':matchId/messages')
  @ApiOperation({
    summary: 'Cursor-paginated message history, newest-first (FR-53, FR-62)',
  })
  getHistory(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Query() query: MessageHistoryQueryDto,
  ) {
    return this.messageService.getHistory(matchId, user.id, query);
  }

  @Post(':matchId/messages')
  @ApiOperation({
    summary:
      'Send a message: match-gated, idempotent, block-checked, rate-limited (FR-53..FR-58)',
  })
  sendMessage(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messageService.sendMessage(matchId, user.id, dto);
  }

  @Post(':matchId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Mark the other participant's messages read (FR-63)",
  })
  async markRead(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
  ) {
    await this.messageService.markRead(matchId, user.id);
  }

  @Post(':matchId/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Block the other participant (FR-64)' })
  async block(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
  ) {
    await this.conversationService.blockOtherParticipant(matchId, user.id);
  }

  @Post(':matchId/report')
  @ApiOperation({
    summary:
      'Report the other participant, always reachable from the conversation (FR-65)',
  })
  report(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Body() dto: ReportConversationDto,
  ) {
    return this.conversationService.reportOtherParticipant(
      matchId,
      user.id,
      dto,
    );
  }
}
