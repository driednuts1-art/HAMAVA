import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReasonCategory } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';

/**
 * FR-72: the shared category+reason shape for every report entry point
 * (standalone `POST /v1/users/:userId/report` and the chat-scoped route).
 * `reason` is optional detail, required only when `category` is `OTHER` —
 * a single ValidateIf gates the whole property: skipped entirely when
 * category isn't OTHER and reason was never provided, otherwise validated
 * as a normal 1-500 char string (so a provided-but-invalid reason still
 * fails even when it wasn't strictly required).
 */
export class ReportReasonDto {
  @ApiProperty({ enum: ReportReasonCategory })
  @IsEnum(ReportReasonCategory)
  category!: ReportReasonCategory;

  @ApiPropertyOptional({ minLength: 1, maxLength: 500 })
  @ValidateIf(
    (dto: ReportReasonDto) =>
      dto.category === ReportReasonCategory.OTHER || dto.reason !== undefined,
  )
  @IsNotEmpty({ message: 'reason is required when category is OTHER' })
  @IsString()
  @Length(1, 500)
  reason?: string;
}
