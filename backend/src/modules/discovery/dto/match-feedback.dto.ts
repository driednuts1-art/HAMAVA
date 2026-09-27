import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MatchFeedbackRating, MatchFeedbackReason } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** FR-293: optional, never required — see match-feedback.service.ts. */
export class MatchFeedbackDto {
  @ApiProperty({ enum: MatchFeedbackRating })
  @IsEnum(MatchFeedbackRating)
  rating!: MatchFeedbackRating;

  @ApiPropertyOptional({ enum: MatchFeedbackReason })
  @IsOptional()
  @IsEnum(MatchFeedbackReason)
  reasonCode?: MatchFeedbackReason;
}
