import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, Length } from 'class-validator';

/** FR-154: the date's own plan — this is what the trusted contact ultimately sees. */
export class CreateDateShareDto {
  @ApiProperty({
    description: 'ISO 8601 datetime; must be in the future (FR-157)',
  })
  @IsDateString()
  datetime!: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  locationText!: string;
}
