import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MatchFeedbackDto } from './dto/match-feedback.dto';
import { MatchFeedbackService } from './match-feedback.service';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/matches/:matchId/feedback')
export class MatchFeedbackController {
  constructor(private readonly feedback: MatchFeedbackService) {}

  @Post()
  @ApiOperation({
    summary: 'Leave (or update) optional match-relevance feedback (FR-293/294)',
  })
  submit(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Body() dto: MatchFeedbackDto,
  ) {
    return this.feedback.submit(user.id, matchId, dto.rating, dto.reasonCode);
  }

  @Get()
  @ApiOperation({
    summary: "The caller's own feedback for this match, if any (FR-295)",
  })
  getMine(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
  ) {
    return this.feedback.getMine(user.id, matchId);
  }
}
