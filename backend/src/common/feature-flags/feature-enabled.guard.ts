import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
  Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * FR-300/301: environment-driven, default-on kill switches — no per-user
 * targeting, no rollout platform (docs/requirements.md Feature 21 Open
 * Items #2, the master directive's own explicit "no over-engineered
 * feature-flag platform" instruction). A disabled feature returns the same
 * RFC 7807 503 shape this codebase already uses for "can't serve this right
 * now" (ProblemDetailsFilter), distinguished from a vendor-down 503 only by
 * its `detail` text.
 *
 * `FeatureEnabledGuard('AI_SEARCH_ENABLED', 'AI Prompt Search')` returns a
 * guard class (not an instance) — the standard Nest pattern for a
 * parameterized guard, since `@UseGuards()` needs a class/token, not a value.
 */
export function FeatureEnabledGuard(
  envVarName:
    | 'AI_SEARCH_ENABLED'
    | 'AI_ONBOARDING_ENABLED'
    | 'VOICE_CALLS_ENABLED'
    | 'VIDEO_CALLS_ENABLED'
    | 'PUBLIC_SAFETY_SHARE_ENABLED',
  featureLabel: string,
): Type<CanActivate> {
  @Injectable()
  class ScopedFeatureEnabledGuard implements CanActivate {
    constructor(private readonly config: ConfigService) {}

    canActivate(): boolean {
      const enabled = this.config.get<string>(envVarName) !== 'false';
      if (!enabled) {
        throw new ServiceUnavailableException(
          `${featureLabel} is temporarily disabled.`,
        );
      }
      return true;
    }
  }

  return ScopedFeatureEnabledGuard;
}
