import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DeckQueryDto } from './dto/deck-query.dto';
import { DeckService } from './deck.service';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/deck')
export class DeckController {
  constructor(private readonly deckService: DeckService) {}

  @Get()
  @ApiOperation({
    summary:
      'Cursor-paginated candidate feed, preference-filtered (FR-36..FR-39)',
  })
  getDeck(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Query() query: DeckQueryDto,
  ) {
    return this.deckService.getDeck(user.id, query);
  }
}
