import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { WhoLikedMeQueryDto } from './dto/who-liked-me-query.dto';
import { WhoLikedMeService } from './who-liked-me.service';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/who-liked-me')
export class WhoLikedMeController {
  constructor(private readonly whoLikedMe: WhoLikedMeService) {}

  @Get()
  @ApiOperation({
    summary:
      'Cursor-paginated list of real candidates who liked the caller, not yet swiped back (FR-453..FR-457)',
  })
  list(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Query() query: WhoLikedMeQueryDto,
  ) {
    return this.whoLikedMe.list(user.id, query.cursor, query.limit);
  }

  @Get('count')
  @ApiOperation({
    summary: 'Real unseen-like count for the tab badge (FR-462)',
  })
  count(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.whoLikedMe.getNewCount(user.id).then((count) => ({ count }));
  }

  @Post('seen')
  @ApiOperation({
    summary: 'Mark the tab seen as of now, resetting the badge (FR-463)',
  })
  async markSeen(@CurrentUser() user: AuthenticatedRequest['user']) {
    await this.whoLikedMe.markSeen(user.id);
    return { ok: true };
  }
}
