import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StartCallDto } from './dto/start-call.dto';
import { EndCallDto } from './dto/end-call.dto';
import { CallService } from './call.service';

/** FR-178..FR-184: the authenticated, match-scoped REST half of Feature 13. */
@ApiTags('calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallController {
  constructor(private readonly calls: CallService) {}

  @Post(':matchId/start')
  @ApiOperation({
    summary: 'Start a voice/video call for a real match (FR-178)',
  })
  start(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Body() dto: StartCallDto,
  ) {
    return this.calls.start(user.id, matchId, dto.type);
  }

  @Post(':matchId/:callSessionId/join')
  @ApiOperation({
    summary: 'Join a ringing call as the other participant (FR-179)',
  })
  join(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Param('callSessionId') callSessionId: string,
  ) {
    return this.calls.join(user.id, matchId, callSessionId);
  }

  @Post(':matchId/:callSessionId/end')
  @ApiOperation({ summary: 'End a call (FR-180)' })
  end(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Param('callSessionId') callSessionId: string,
    @Body() dto: EndCallDto,
  ) {
    // Feature 18 §8: a real, narrowly-validated client-reported reason
    // (EndCallDto's own enum already excludes the server-owned values).
    return this.calls.end(
      user.id,
      matchId,
      callSessionId,
      dto,
      dto.endReason ?? 'COMPLETED',
    );
  }

  @Get(':matchId/active')
  @ApiOperation({
    summary:
      'The current RINGING/ACTIVE call session for this match, if any (FR-183)',
  })
  getActive(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
  ) {
    return this.calls.getActive(user.id, matchId);
  }
}
