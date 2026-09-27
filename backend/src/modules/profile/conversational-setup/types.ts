/**
 * FR-138: the fixed, closed set of Feature 2 fields this feature can ever
 * fill — never gender/datingIntent, never anything else. Both the
 * extraction schema and the confirm endpoint are constrained to exactly
 * this list, by construction.
 */
export const CONVERSATIONAL_FIELDS = [
  'displayName',
  'birthDate',
  'city',
  'bio',
  'interests',
] as const;

export type ConversationalField = (typeof CONVERSATIONAL_FIELDS)[number];

export interface ConversationalTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Redis-only session state (FR-132, FR-143/144) — never a Prisma model. */
export interface ConversationalSetupSession {
  sessionId: string;
  userId: string;
  createdAt: string;
  /** UX-only cache of this session's own confirmed fields (FR-141 writes the real record). */
  confirmedFields: ConversationalField[];
  /** Bounded window — never the full unbounded history. */
  recentTurns: ConversationalTurn[];
  turnCount: number;
  /**
   * Feature 21 (FR-287): the most recent real proposal's field + the AI's
   * own stated confidence in it — so a matching `confirm()` call can attach
   * that confidence to the resulting attribute-provenance row. Cleared
   * (undefined) once consumed or once a different field is proposed next.
   */
  lastProposal?: { field: ConversationalField; confidence: number | null };
}

/**
 * FR-138/FR-142: `field`/values are mutually exclusive with which one is
 * populated — always-present-but-nullable, matching this codebase's
 * established OpenAI Structured Outputs idiom (see `ExtractedFilters`).
 * `birthDateDisplay` is Feature 11's highest-risk-item mitigation
 * (Open Items #1): the resolved value must always name both the source
 * calendar interpretation and the resulting Gregorian date, never the bare
 * Gregorian date alone.
 */
export interface ExtractedTurnField {
  field: ConversationalField | null;
  stringValue: string | null;
  interestsValue: string[] | null;
  birthDateGregorian: string | null;
  birthDateDisplay: string | null;
  /**
   * Feature 21 (FR-287): the model's own stated confidence (0..1) that
   * `field`'s proposed value is correct, given ONLY what the user actually
   * said this turn — null when `field` is null (nothing was proposed).
   * Recorded as attribute provenance once the user confirms; never used to
   * gate or auto-accept anything — confirmation is still always required.
   */
  confidence: number | null;
}

/**
 * `completed`/`remainingFields` are deliberately NOT part of this result —
 * which fields remain is authoritative session state (`confirmedFields`),
 * computed in code by `ConversationalSetupService`, never left for the LLM
 * to track or potentially get wrong.
 */
export interface TurnExtractionResult {
  proposed: ExtractedTurnField;
  assistantReply: string;
}
