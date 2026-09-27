import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
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
import { UserSafetyService } from './user-safety.service';
import { ReportReasonDto } from './dto/report-reason.dto';

@ApiTags('safety')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/:userId')
export class SafetyController {
  constructor(private readonly userSafety: UserSafetyService) {}

  @Post('block')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Block a user directly, no existing match required (FR-71)',
  })
  async block(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('userId') userId: string,
  ) {
    await this.userSafety.block(user.id, userId);
  }

  @Post('report')
  @ApiOperation({
    summary: 'Report a user directly, no existing match required (FR-71)',
  })
  report(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Param('userId') userId: string,
    @Body() dto: ReportReasonDto,
  ) {
    return this.userSafety.report(user.id, userId, dto);
  }
}
