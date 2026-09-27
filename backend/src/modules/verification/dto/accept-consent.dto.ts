import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptConsentDto {
  @ApiProperty({
    description:
      'The privacy-policy version shown to the user on the consent screen',
  })
  @IsString()
  @IsNotEmpty()
  policyVersion!: string;
}
