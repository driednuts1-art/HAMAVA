import { ApiProperty } from '@nestjs/swagger';
import { SwipeAction } from '@prisma/client';
import { IsEnum, IsUUID } from 'class-validator';

export class SwipeDto {
  @ApiProperty()
  @IsUUID()
  targetUserId!: string;

  @ApiProperty({ enum: SwipeAction })
  @IsEnum(SwipeAction)
  action!: SwipeAction;
}
