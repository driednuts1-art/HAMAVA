import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from './guards/admin.guard';
import { ModerationFlagService } from '../../common/moderation/moderation-flag.service';
import { ListModerationFlagsQueryDto } from './dto/list-moderation-flags-query.dto';
import { ResolveModerationFlagDto } from './dto/resolve-moderation-flag.dto';

/**
 * FR-98, FR-99: minimal admin content-moderation review surface — a list +
 * resolve endpoint, reusing the exact same shape as the report-review
 * surface (docs/requirements.md Feature 5), not a new design.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/moderation-flags')
export class ModerationController {
  constructor(private readonly moderationFlags: ModerationFlagService) {}

  @Get()
  @ApiOperation({
    summary:
      'Human review queue for moderation rejections, oldest-open-first (FR-98)',
  })
  list(@Query() query: ListModerationFlagsQueryDto) {
    return this.moderationFlags.list(query.status, query.cursor, query.limit);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Resolve a flag (UPHELD/OVERTURNED) — review only, no republishing (FR-99)',
  })
  resolve(
    @CurrentUser() admin: AuthenticatedRequest['user'],
    @Param('id') id: string,
    @Body() dto: ResolveModerationFlagDto,
  ) {
    return this.moderationFlags.resolve(
      id,
      admin.id,
      dto.resolution,
      dto.resolutionNote,
    );
  }
}
