import { ApiProperty } from '@nestjs/swagger';
import { Gender, RelationshipGoal } from '@prisma/client';

/** FR-104: nothing here is ever candidate/profile-shaped data — filter parameters only. */
export class ExtractedFiltersResponseDto {
  @ApiProperty({ nullable: true, type: String })
  city!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  minAge!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  maxAge!: number | null;

  @ApiProperty({ enum: Gender, isArray: true })
  gender!: Gender[];

  @ApiProperty({ enum: RelationshipGoal, isArray: true })
  relationshipGoal!: RelationshipGoal[];

  @ApiProperty()
  semanticQuery!: string;
}

export class ExtractTextResponseDto {
  @ApiProperty({ type: ExtractedFiltersResponseDto })
  filters!: ExtractedFiltersResponseDto;
}

export class TranscribeResponseDto extends ExtractTextResponseDto {
  @ApiProperty({
    description: 'Whisper transcript, shown for user confirm/edit (FR-108)',
  })
  transcribedText!: string;
}
