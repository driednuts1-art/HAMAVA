import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/**
 * Shape for a future real (async) liveness vendor's result callback/webhook.
 * The mock provider resolves synchronously and does not call this endpoint;
 * it exists so the API surface doesn't have to change when a real vendor is
 * wired in (docs/roadmap.md §2).
 */
export class LivenessCallbackDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  providerSessionRef!: string;

  @ApiProperty({ enum: ['pass', 'fail'] })
  @IsIn(['pass', 'fail'])
  result!: 'pass' | 'fail';
}
