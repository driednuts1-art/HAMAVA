import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ModerationFlagStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

export class ListModerationFlagsQueryDto {
  @ApiPropertyOptional({ enum: ModerationFlagStatus })
  @IsOptional()
  @IsEnum(ModerationFlagStatus)
  status?: ModerationFlagStatus;

  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous response (FR-98)',
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
