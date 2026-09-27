import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { DateShareService } from './date-share.service';

/**
 * FR-162: the one deliberately public, unauthenticated endpoint in this
 * codebase — no @UseGuards, mirroring AuthController's own bare style
 * (the only other fully-public controller here). Kept in its own
 * controller, not merged into DateShareController, so "this file has no
 * auth guard" is visible at a glance rather than buried among guarded routes.
 */
@ApiTags('date-share')
@Controller('date-share')
export class PublicDateShareController {
  constructor(private readonly dateShare: DateShareService) {}

  @Get(':token')
  @ApiOperation({
    summary: "The trusted contact's view — no account needed (FR-162..FR-167)",
  })
  lookup(@Param('token') token: string, @Req() req: Request) {
    return this.dateShare.lookup(token, req.ip ?? 'unknown');
  }
}
