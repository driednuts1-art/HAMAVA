import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationFlagResolution } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ResolveModerationFlagDto {
  @ApiProperty({ enum: ModerationFlagResolution })
  @IsEnum(ModerationFlagResolution)
  resolution!: ModerationFlagResolution;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  resolutionNote?: string;
}
