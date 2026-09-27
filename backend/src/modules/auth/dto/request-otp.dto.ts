import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

// E.164: leading +, 8–15 digits total, first digit 1-9 (FR-1).
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export class RequestOtpDto {
  @ApiProperty({ example: '+989121234567' })
  @Matches(E164_PATTERN, {
    message: 'phone must be a valid E.164 phone number',
  })
  phone!: string;
}
