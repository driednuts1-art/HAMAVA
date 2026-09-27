import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, RelationshipGoal } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ minimum: 18, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(100)
  minAge?: number;

  @ApiPropertyOptional({ minimum: 18, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(100)
  maxAge?: number;

  @ApiPropertyOptional({
    enum: Gender,
    isArray: true,
    description: 'Empty = no restriction',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Gender, { each: true })
  genderPref?: Gender[];

  @ApiPropertyOptional({
    enum: RelationshipGoal,
    isArray: true,
    description: 'Empty = no restriction',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RelationshipGoal, { each: true })
  relationshipGoalPref?: RelationshipGoal[];

  @ApiPropertyOptional({
    description: 'FR-47: defaults to true, not an opt-in',
  })
  @IsOptional()
  @IsBoolean()
  verifiedOnly?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activeThisWeekOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Feature 27 (FR-489): createdAt within the last 7 days.',
  })
  @IsOptional()
  @IsBoolean()
  newMembersOnly?: boolean;
}
