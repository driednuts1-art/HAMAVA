import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export class VerifyOtpDto {
  @ApiProperty({ example: '+989121234567' })
  @Matches(E164_PATTERN, {
    message: 'phone must be a valid E.164 phone number',
  })
  phone!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit numeric string' })
  code!: string;
}
