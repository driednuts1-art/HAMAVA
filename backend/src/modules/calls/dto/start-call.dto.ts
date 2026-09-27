import { ApiProperty } from '@nestjs/swagger';
import { CallType } from '@prisma/client';
import { IsEnum } from 'class-validator';

/** FR-178. */
export class StartCallDto {
  @ApiProperty({ enum: CallType })
  @IsEnum(CallType)
  type!: CallType;
}
