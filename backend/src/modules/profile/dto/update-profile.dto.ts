import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  DrinkingHabit,
  Education,
  ExerciseHabit,
  Gender,
  KidsStatus,
  PoliticalView,
  RelationshipGoal,
  SmokingHabit,
  ZodiacSign,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PROMPT_IDS } from '../prompts.constants';

const MAX_PROMPT_ANSWERS = 3;
const MAX_LANGUAGES = 7;

// FR-447: the real, finite list this app's global audience actually needs
// (product.md's stated market, revised for the English/global identity
// pivot — docs/i18n-rtl-migration-scope.md) — server-constrained, same
// posture as every other fixed real list in this DTO.
export const REAL_LANGUAGES = [
  'Persian',
  'English',
  'German',
  'French',
  'Arabic',
  'Turkish',
  'Spanish',
] as const;

/**
 * FR-432/FR-434: `promptId` must be a real id from the fixed prompt list
 * (`prompts.constants.ts`) — validated here structurally; "no duplicate
 * promptId across the array" is a cross-item check, done in
 * `ProfileService` alongside the real moderation check, not here.
 */
export class PromptAnswerDto {
  @ApiPropertyOptional({ enum: PROMPT_IDS as unknown as string[] })
  @IsIn(PROMPT_IDS)
  promptId!: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 300 })
  @IsString()
  @Length(1, 300)
  answer!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 date; age is validated server-side (FR-20)',
  })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'FR-445: current city (relabeled from plain "city" in the UI)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  interests?: string[];

  @ApiPropertyOptional({
    enum: Gender,
    description:
      'Technical-minimum taxonomy, needed for discovery filtering (Feature 3)',
  })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    enum: RelationshipGoal,
    description: "product.md §7.2 'Dating Intent field'",
  })
  @IsOptional()
  @IsEnum(RelationshipGoal)
  datingIntent?: RelationshipGoal;

  // ---- Feature 24: real profile depth ----

  @ApiPropertyOptional({
    type: [PromptAnswerDto],
    maxItems: MAX_PROMPT_ANSWERS,
    description:
      'FR-432/434/436: 2-3 answers required for profileCompletedAt (FR-435)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PROMPT_ANSWERS)
  @ValidateNested({ each: true })
  @Type(() => PromptAnswerDto)
  promptAnswers?: PromptAnswerDto[];

  @ApiPropertyOptional({ minimum: 140, maximum: 220, description: 'cm' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(140)
  @Max(220)
  height?: number;

  @ApiPropertyOptional({ enum: Education })
  @IsOptional()
  @IsEnum(Education)
  education?: Education;

  @ApiPropertyOptional({ enum: ExerciseHabit })
  @IsOptional()
  @IsEnum(ExerciseHabit)
  exerciseHabit?: ExerciseHabit;

  @ApiPropertyOptional({ enum: KidsStatus })
  @IsOptional()
  @IsEnum(KidsStatus)
  hasKids?: KidsStatus;

  @ApiPropertyOptional({ enum: ZodiacSign })
  @IsOptional()
  @IsEnum(ZodiacSign)
  zodiacSign?: ZodiacSign;

  @ApiPropertyOptional({
    enum: PoliticalView,
    description:
      'Feature 24 §10 #3: three deliberately neutral values, not a left/right axis',
  })
  @IsOptional()
  @IsEnum(PoliticalView)
  politicalView?: PoliticalView;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'FR-444: independent of `city` — "current city" vs "hometown"',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  hometown?: string;

  @ApiPropertyOptional({
    type: [String],
    enum: REAL_LANGUAGES,
    maxItems: MAX_LANGUAGES,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LANGUAGES)
  @ArrayUnique()
  @IsIn(REAL_LANGUAGES, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ enum: DrinkingHabit })
  @IsOptional()
  @IsEnum(DrinkingHabit)
  drinking?: DrinkingHabit;

  @ApiPropertyOptional({ enum: SmokingHabit })
  @IsOptional()
  @IsEnum(SmokingHabit)
  smoking?: SmokingHabit;

  @ApiPropertyOptional({
    description:
      'FR-451: hides the whole drinking+smoking category, not just empty values',
  })
  @IsOptional()
  @IsBoolean()
  hideDrinkingSmoking?: boolean;
}
