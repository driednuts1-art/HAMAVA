import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

const MAX_PROMPT_LENGTH = 500;

export class ExtractTextDto {
  @ApiProperty({ description: 'Free-text search prompt (FR-104)' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_PROMPT_LENGTH)
  text!: string;
}
