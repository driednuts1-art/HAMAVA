/**
 * Feature 21 (FR-291/FR-292): a versioned match-score skeleton. Only
 * `semanticSimilarity` is real today — every other signal is a documented,
 * reserved placeholder for future work (compatibility/complementarity
 * matching, Persona/Intent/Need/Offer — all explicitly out of scope right
 * now, docs/architecture-review-v2.md §G). Adding this scaffold does not
 * change any ranking behavior: the existing `ORDER BY distance ASC,
 * "createdAt" ASC, id ASC` in AiSearchService is untouched — this is
 * observability/versioning infrastructure, not Matching V2.
 */
export const MATCH_ALGORITHM_VERSION = 'MATCH_ALGORITHM_V1' as const;

export interface MatchSignals {
  /** Real today: 1 - (cosine distance / 2), clamped to [0, 1]. */
  semanticSimilarity: number;
  /** Reserved — no Need/Offer/Persona/Intent model exists yet (Bucket B, explicitly deferred). */
  goalCompatibility?: number;
  needOfferCompatibility?: number;
  preferenceCompatibility?: number;
  contextualCompatibility?: number;
  trustSignal?: number;
  behavioralCompatibility?: number;
}

export interface MatchScore {
  /** Today, simply `signals.semanticSimilarity` — a real weighted blend needs more than one real signal to blend. */
  total: number;
  signals: MatchSignals;
  version: typeof MATCH_ALGORITHM_VERSION;
}

/**
 * Cosine distance (pgvector's `<=>`) ranges 0 (identical) to 2 (opposite).
 * `1 - distance / 2` maps that onto [0, 1], 1 being most similar — a simple,
 * documented, real transform, not an arbitrary placeholder.
 */
export function computeMatchScoreFromDistance(distance: number): MatchScore {
  const semanticSimilarity = Math.max(0, Math.min(1, 1 - distance / 2));
  return {
    total: semanticSimilarity,
    signals: { semanticSimilarity },
    version: MATCH_ALGORITHM_VERSION,
  };
}
