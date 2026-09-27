import { ApiPropertyOptional } from '@nestjs/swagger';
import { MessagingPermission } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

/** FR-80: partial update — either field alone, or both. */
export class UpdatePrivacyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  preciseLocationEnabled?: boolean;

  @ApiPropertyOptional({ enum: MessagingPermission })
  @IsOptional()
  @IsEnum(MessagingPermission)
  messagingPermission?: MessagingPermission;

  @ApiPropertyOptional({
    description:
      "Feature 12: allow appearing in other users' Share My Date links (FR-171)",
  })
  @IsOptional()
  @IsBoolean()
  allowInSafetyShares?: boolean;

  @ApiPropertyOptional({
    description:
      "Feature 27 (FR-484): symmetric — off hides this user's own presence " +
      "from others AND hides everyone else's presence from this user.",
  })
  @IsOptional()
  @IsBoolean()
  showLastActiveStatus?: boolean;
}
