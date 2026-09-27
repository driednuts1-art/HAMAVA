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
import { ReportService } from '../safety/report.service';
import { ListReportsQueryDto } from './dto/list-reports-query.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';

/**
 * FR-73..FR-76: minimal admin report-review surface — a list + resolve
 * endpoint, not a dashboard (docs/requirements.md Feature 5 §2).
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/reports')
export class AdminController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  @ApiOperation({
    summary: 'Human review queue for reports, oldest-open-first (FR-74)',
  })
  list(@Query() query: ListReportsQueryDto) {
    return this.reportService.list(query.status, query.cursor, query.limit);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Mark a report resolved — review only, no enforcement action (FR-75)',
  })
  resolve(
    @CurrentUser() admin: AuthenticatedRequest['user'],
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reportService.resolve(id, admin.id, dto.resolutionNote);
  }
}
