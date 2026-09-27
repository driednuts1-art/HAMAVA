import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SwipeDto } from './dto/swipe.dto';
import { SwipeService } from './swipe.service';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/swipes')
export class SwipeController {
  constructor(private readonly swipeService: SwipeService) {}

  @Post()
  @ApiOperation({
    summary:
      'Record a like/pass/super-like; creates a Match on a mutual like (FR-40..FR-44)',
  })
  swipe(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: SwipeDto,
  ) {
    return this.swipeService.recordSwipe(user.id, dto.targetUserId, dto.action);
  }
}
