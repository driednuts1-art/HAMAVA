import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PreferencesService } from './preferences.service';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('discovery/preferences')
export class PreferencesController {
  constructor(private readonly preferencesService: PreferencesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Effective discovery filters, defaulted if never saved (FR-46, FR-47)',
  })
  getPreferences(@CurrentUser() user: AuthenticatedRequest['user']) {
    return this.preferencesService.getEffective(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update discovery filters (partial)' })
  updatePreferences(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.preferencesService.update(user.id, dto);
  }
}
