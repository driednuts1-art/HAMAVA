import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FeatureEnabledGuard } from './feature-enabled.guard';

function buildConfig(value: Record<string, string>): ConfigService {
  return { get: (key: string) => value[key] } as unknown as ConfigService;
}

const NOOP_CONTEXT = {} as ExecutionContext;

describe('FeatureEnabledGuard (FR-300/301)', () => {
  it('allows the request through when the env var is "true"', () => {
    const GuardClass = FeatureEnabledGuard(
      'AI_SEARCH_ENABLED',
      'AI Prompt Search',
    );
    const guard = new GuardClass(buildConfig({ AI_SEARCH_ENABLED: 'true' }));
    expect(guard.canActivate(NOOP_CONTEXT)).toBe(true);
  });

  it('allows the request through when the env var is unset — default-on, never a silent regression', () => {
    const GuardClass = FeatureEnabledGuard(
      'AI_SEARCH_ENABLED',
      'AI Prompt Search',
    );
    const guard = new GuardClass(buildConfig({}));
    expect(guard.canActivate(NOOP_CONTEXT)).toBe(true);
  });

  it('throws ServiceUnavailableException with a clear, feature-specific detail when explicitly "false"', () => {
    const GuardClass = FeatureEnabledGuard(
      'AI_ONBOARDING_ENABLED',
      'Conversational profile setup',
    );
    const guard = new GuardClass(
      buildConfig({ AI_ONBOARDING_ENABLED: 'false' }),
    );

    expect(() => guard.canActivate(NOOP_CONTEXT)).toThrow(
      ServiceUnavailableException,
    );
    try {
      void guard.canActivate(NOOP_CONTEXT);
    } catch (err) {
      expect((err as ServiceUnavailableException).message).toContain(
        'Conversational profile setup',
      );
    }
  });

  it('each call to the factory produces an independently configurable guard (no shared state across flags)', () => {
    const SearchGuard = FeatureEnabledGuard(
      'AI_SEARCH_ENABLED',
      'AI Prompt Search',
    );
    const OnboardingGuard = FeatureEnabledGuard(
      'AI_ONBOARDING_ENABLED',
      'Conversational profile setup',
    );
    const config = buildConfig({
      AI_SEARCH_ENABLED: 'false',
      AI_ONBOARDING_ENABLED: 'true',
    });

    expect(() => new SearchGuard(config).canActivate(NOOP_CONTEXT)).toThrow();
    expect(new OnboardingGuard(config).canActivate(NOOP_CONTEXT)).toBe(true);
  });
});
