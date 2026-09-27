import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Gender, RelationshipGoal } from '@prisma/client';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * FR-103/FR-115: the client submits exactly what it confirmed (chips the
 * user reviewed/edited, per the extract or transcribe response) — this is
 * never auto-populated server-side from the original prompt. `mode` is
 * required so the rate limiter (FR-115) can charge the right bucket; it is
 * NOT re-derived from anything else, since the server has no other way to
 * know whether this search followed a text or voice extraction.
 *
 * Deliberately has no `verifiedOnly` field — FR-110's floor always comes
 * from the caller's own `DiscoveryPreferences`, never from a request body.
 */
export class AiSearchDto {
  @ApiProperty({ enum: ['TEXT', 'VOICE'] })
  @IsIn(['TEXT', 'VOICE'])
  mode!: 'TEXT' | 'VOICE';

  @ApiProperty({ description: 'Confirmed/edited semantic query text (FR-111)' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  semanticQuery!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(100)
  minAge?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(18)
  @Max(100)
  maxAge?: number;

  @ApiPropertyOptional({ enum: Gender, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Gender, { each: true })
  gender?: Gender[];

  @ApiPropertyOptional({ enum: RelationshipGoal, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(RelationshipGoal, { each: true })
  relationshipGoal?: RelationshipGoal[];

  @ApiPropertyOptional({
    description: 'Opaque ranked cursor from a previous response (FR-113)',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: DEFAULT_LIMIT, maximum: MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;
}
