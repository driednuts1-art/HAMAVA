import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthenticatedRequest,
  JwtAuthGuard,
} from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ExtractTextDto } from './dto/extract-text.dto';
import { AiSearchDto } from './dto/ai-search.dto';
import { AiSearchExtractionService } from './ai-search-extraction.service';
import { AiSearchService } from './ai-search.service';
import { FeatureEnabledGuard } from '../../../common/feature-flags/feature-enabled.guard';

@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(
  JwtAuthGuard,
  FeatureEnabledGuard('AI_SEARCH_ENABLED', 'AI Prompt Search'),
)
@Controller('discovery/ai-search')
export class AiSearchController {
  constructor(
    private readonly extraction: AiSearchExtractionService,
    private readonly aiSearch: AiSearchService,
  ) {}

  @Post('extract')
  @ApiOperation({
    summary:
      'Extract structured filters from free text — never executes a search (FR-103, FR-104)',
  })
  async extract(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: ExtractTextDto,
  ) {
    const filters = await this.extraction.extractFromText(user.id, dto.text);
    return { filters };
  }

  @Post('transcribe')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Transcribe Persian voice input and extract filters from it — never executes a search (FR-105..FR-108)',
  })
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @UploadedFile() file: Express.Multer.File,
  ) {
    const { transcribedText, filters } =
      await this.extraction.transcribeAndExtract(
        user.id,
        file.buffer,
        file.originalname,
        file.mimetype,
      );
    return { transcribedText, filters };
  }

  @Post()
  @ApiOperation({
    summary:
      'Run the confirmed search: hard filter then semantic ranking, cursor-paginated (FR-109..FR-114)',
  })
  search(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() dto: AiSearchDto,
  ) {
    return this.aiSearch.search(user.id, dto);
  }
}
