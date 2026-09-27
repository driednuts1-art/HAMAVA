import { RelationshipGoal } from '@prisma/client';

export const MATCH_EXPLANATION_PROVIDER = Symbol('MATCH_EXPLANATION_PROVIDER');

/**
 * FR-118: exactly the fields a "Why You Two?"/Super Like explanation may be
 * grounded in — the same set `product.md` §7.2 and this project's other
 * profile-driven features already treat as "profile data the user actually
 * entered." Deliberately excludes anything behavioral/learned (no
 * Compatibility Score signal exists to include even if we wanted to).
 */
export interface MatchExplanationFacts {
  displayName: string | null;
  age: number | null;
  city: string | null;
  bio: string | null;
  interests: string[];
  datingIntent: RelationshipGoal | null;
}

/**
 * Feature 21 (FR-302): a positive-only string was the pre-Feature-21 shape.
 * `mismatches` may legitimately be an empty array for a strongly-aligned
 * pair — that's a real, valid outcome (FR-304), not evidence of a failed
 * generation.
 */
export interface GeneratedExplanation {
  reasons: string[];
  mismatches: string[];
}

export interface GroundingCheckResult {
  grounded: boolean;
  unsupportedClaim: string | null;
}

/**
 * Two real, independent vendor calls (FR-118, FR-119) — deliberately not
 * one call trusted to both generate and self-certify, since a hallucinating
 * model is not a reliable judge of its own hallucination. Both throw
 * (fail CLOSED at the provider level, matching every other real provider in
 * this codebase) — the caller (`MatchExplanationService`) is responsible for
 * this feature's fail-OPEN posture (FR-121), exactly mirroring how
 * `ProfileService.recomputeBioEmbedding()` catches `EmbeddingProviderInterface`'s
 * failures rather than the provider silently swallowing them itself.
 *
 * FR-302: `checkGrounded()` validates every claim across BOTH `reasons` and
 * `mismatches` against the same `MatchExplanationFacts` — a fabricated
 * mismatch is exactly as much a hallucination risk as a fabricated reason.
 */
export interface MatchExplanationProviderInterface {
  generate(
    userA: MatchExplanationFacts,
    userB: MatchExplanationFacts,
  ): Promise<GeneratedExplanation>;
  checkGrounded(
    userA: MatchExplanationFacts,
    userB: MatchExplanationFacts,
    explanation: GeneratedExplanation,
  ): Promise<GroundingCheckResult>;
}
