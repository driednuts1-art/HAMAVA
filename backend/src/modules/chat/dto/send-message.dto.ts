import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, Length } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 2000)
  content!: string;

  @ApiProperty({
    description:
      'Client-generated UUID; retried sends reuse the same value (FR-54)',
  })
  @IsUUID()
  clientIdempotencyKey!: string;
}
