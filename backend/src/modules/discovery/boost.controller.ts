import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BoostService } from './boost.service';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/boost')
export class BoostController {
  constructor(private readonly boostService: BoostService) {}

  @Post()
  @ApiOperation({
    summary:
      'Activate a time-boxed Smart Boost (FR-126); 409 if already active',
  })
  activate(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.boostService.activate(user.id);
  }

  @Get()
  @ApiOperation({ summary: "The caller's current boost status (FR-127)" })
  getStatus(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.boostService.getStatus(user.id);
  }
}
