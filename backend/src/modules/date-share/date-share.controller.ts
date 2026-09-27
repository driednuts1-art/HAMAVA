import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CreateDateShareDto } from './dto/create-date-share.dto';
import { DateShareService } from './date-share.service';
import { FeatureEnabledGuard } from '../../common/feature-flags/feature-enabled.guard';

/** FR-154, FR-160, FR-161: the authenticated, match-scoped half of Feature 12. */
@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/matches/:matchId/date-share')
export class DateShareController {
  constructor(private readonly dateShare: DateShareService) {}

  @Post()
  @UseGuards(
    FeatureEnabledGuard('PUBLIC_SAFETY_SHARE_ENABLED', 'Share My Date'),
  )
  @ApiOperation({
    summary: 'Create a Share My Date link for a real match (FR-154..FR-159)',
  })
  create(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Body() dto: CreateDateShareDto,
  ) {
    return this.dateShare.create(user.id, matchId, dto);
  }

  @Get()
  @ApiOperation({
    summary: "The caller's own date-share links for this match (FR-160)",
  })
  list(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
  ) {
    return this.dateShare.list(user.id, matchId);
  }

  @Delete(':linkId')
  @ApiOperation({ summary: 'Revoke a link early (FR-161)' })
  revoke(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('matchId') matchId: string,
    @Param('linkId') linkId: string,
  ) {
    return this.dateShare.revoke(user.id, matchId, linkId);
  }
}
