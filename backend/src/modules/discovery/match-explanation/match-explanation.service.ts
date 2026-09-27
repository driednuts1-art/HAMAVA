import { Inject, Injectable, Logger } from '@nestjs/common';
import { MATCH_EXPLANATION_PROVIDER } from './match-explanation-provider.interface';
import type {
  GeneratedExplanation,
  MatchExplanationFacts,
  MatchExplanationProviderInterface,
} from './match-explanation-provider.interface';

/**
 * FR-118..FR-121, extended by Feature 21 (FR-302..FR-304): the one place
 * this feature's "generate, verify, and fail open" logic lives —
 * `SwipeService` (Super Like) and `MatchService` ("Why You Two?") both call
 * this and only ever get back `GeneratedExplanation | null`, never having to
 * know about the two-call/grounding-check mechanics themselves.
 *
 * Deliberately fail-OPEN, not fail-closed (contrast FR-100/FR-110): a
 * vendor failure, or a real but ungrounded/hallucinated result caught by
 * FR-119's check, both just mean "no explanation this time" — never a
 * blocked swipe, never a blocked match read. Mirrors
 * `ProfileService.recomputeBioEmbedding()`'s exact precedent.
 *
 * A grounding rejection is an EXPECTED, not exceptional, outcome: the
 * generation call is non-deterministic, so the same two profiles can
 * produce a safely-phrased explanation on one call and an over-claiming one
 * on the next (see docs/architecture.md's Feature 10 section for a real
 * observed example) — callers and their tests must treat `null` as a
 * routine result, not evidence of a bug.
 */
@Injectable()
export class MatchExplanationService {
  private readonly logger = new Logger(MatchExplanationService.name);

  constructor(
    @Inject(MATCH_EXPLANATION_PROVIDER)
    private readonly provider: MatchExplanationProviderInterface,
  ) {}

  async generate(
    userA: MatchExplanationFacts,
    userB: MatchExplanationFacts,
  ): Promise<GeneratedExplanation | null> {
    let explanation: GeneratedExplanation;
    try {
      explanation = await this.provider.generate(userA, userB);
    } catch (err) {
      this.logger.warn(
        `Could not generate a match explanation: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    try {
      const check = await this.provider.checkGrounded(
        userA,
        userB,
        explanation,
      );
      if (!check.grounded) {
        this.logger.warn(
          `Discarded an ungrounded match explanation (unsupported claim: ${check.unsupportedClaim ?? 'unspecified'}).`,
        );
        return null;
      }
    } catch (err) {
      this.logger.warn(
        `Could not verify a match explanation's grounding: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    return explanation;
  }
}
