import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor(message: string) {
    super(
      { error: 'Too Many Requests', message },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
