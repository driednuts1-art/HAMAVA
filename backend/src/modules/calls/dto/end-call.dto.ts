import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * FR-180: connectionType/qualityStatsRef are client-reported only, never
 * independently verified — informational/debugging use only (§8, Security
 * requirements), never gated on for anything security- or billing-relevant.
 *
 * Feature 18 §8: endReason joins that same trust boundary, restricted to a
 * narrow, explicit enum — a client may claim its own call was declined or
 * hit the real first-call duration limit (real, client-observable facts
 * about a call it was a participant in), but never 'COMPLETED' (the real
 * default for a normal hangup) or 'MISSED' (exclusively the server's own
 * lazy-expiry finding, CallService's loadOwned/join path — a client
 * claiming its own call was "missed" would be a meaningless self-report).
 */
export class EndCallDto {
  @ApiPropertyOptional({ enum: ['p2p', 'relayed'] })
  @IsOptional()
  @IsIn(['p2p', 'relayed'])
  connectionType?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  qualityStatsRef?: string;

  @ApiPropertyOptional({ enum: ['DECLINED', 'DURATION_LIMIT_REACHED'] })
  @IsOptional()
  @IsIn(['DECLINED', 'DURATION_LIMIT_REACHED'])
  endReason?: 'DECLINED' | 'DURATION_LIMIT_REACHED';
}
