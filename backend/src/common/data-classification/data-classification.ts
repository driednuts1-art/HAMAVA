/**
 * FR-290 (Feature 21): a typed reference for the field classifications
 * documented in docs/data-classification.md — NOT a new enforcement layer.
 * Every check this catalog describes already exists and is already correct
 * (buildSafetyExclusionWhere, DeckCandidate's explicit field selection,
 * ModerationFlag's own access rules, etc. — see docs/architecture-review-v2.md
 * §F). This module exists so *future* code has one typed place to consult
 * ("can matching use this field? can AI see it?") instead of re-deriving the
 * answer from scratch — it does not replace, wrap, or intercept any existing
 * check. Nothing here changes behavior.
 */

export type DataClassificationLevel =
  | 'PUBLIC'
  | 'MATCH_ONLY'
  | 'PRIVATE'
  | 'SENSITIVE'
  | 'HIGHLY_SENSITIVE'
  | 'VERIFIED_ONLY';

export interface FieldClassification {
  /** The real enforcement mechanism today — named, not invented. */
  enforcedBy: string;
  level: DataClassificationLevel;
  /** May a matching/ranking signal (deck, AI search) read this field? */
  visibleToMatching: boolean;
  /** May an AI provider (extraction, embedding, explanation) read this field? */
  visibleToAi: boolean;
}

/**
 * Keyed as `${modelName}.${fieldName}` to stay unambiguous across models —
 * see docs/data-classification.md for the prose form of this same catalog.
 */
export const DATA_CLASSIFICATION: Record<string, FieldClassification> = {
  'User.phoneHash': {
    level: 'HIGHLY_SENSITIVE',
    enforcedBy:
      'Never serialized in any API response — read only by OtpService/UsersService for lookup.',
    visibleToMatching: false,
    visibleToAi: false,
  },
  'User.bioEmbedding': {
    level: 'PRIVATE',
    enforcedBy:
      'Unsupported("vector") — Prisma cannot even select it into a normal query result; read only via raw SQL in AiSearchService.',
    visibleToMatching: true,
    visibleToAi: false,
  },
  'User.displayName': {
    level: 'MATCH_ONLY',
    enforcedBy:
      "DeckCandidate's explicit field list (deck.service.ts, ai-search.service.ts) — never a full-row serialization.",
    visibleToMatching: true,
    visibleToAi: true,
  },
  'User.birthDate': {
    level: 'PRIVATE',
    enforcedBy:
      "Never returned directly — only computeAge()'s derived `age` appears in a DeckCandidate.",
    visibleToMatching: true,
    visibleToAi: true,
  },
  'User.city': {
    level: 'MATCH_ONLY',
    enforcedBy: "DeckCandidate's explicit field list.",
    visibleToMatching: true,
    visibleToAi: true,
  },
  'User.bio': {
    level: 'MATCH_ONLY',
    enforcedBy:
      "DeckCandidate's explicit field list; also the source text for bioEmbedding and match-explanation facts.",
    visibleToMatching: true,
    visibleToAi: true,
  },
  'User.interests': {
    level: 'MATCH_ONLY',
    enforcedBy: "DeckCandidate's explicit field list.",
    visibleToMatching: true,
    visibleToAi: true,
  },
  'User.gender': {
    level: 'MATCH_ONLY',
    enforcedBy:
      'DiscoveryPreferences.genderPref filtering; not shown as a candidate-facing field itself.',
    visibleToMatching: true,
    visibleToAi: false,
  },
  'User.datingIntent': {
    level: 'MATCH_ONLY',
    enforcedBy:
      'DiscoveryPreferences.relationshipGoalPref filtering and MatchExplanationFacts.',
    visibleToMatching: true,
    visibleToAi: true,
  },
  'User.livenessStatus': {
    level: 'VERIFIED_ONLY',
    enforcedBy:
      'buildSafetyExclusionWhere() (candidate-exclusion.util.ts) — the FR-47/FR-79 verified-only floor, structurally unreachable from any prompt/AI output.',
    visibleToMatching: true,
    visibleToAi: false,
  },
  'User.messagingPermission': {
    level: 'PRIVATE',
    enforcedBy:
      "buildSafetyExclusionWhere() and SwipeService's in-transaction re-check — never exposed to the other party directly.",
    visibleToMatching: true,
    visibleToAi: false,
  },
  'User.preciseLocationEnabled': {
    level: 'PRIVATE',
    enforcedBy:
      'settings.service.ts — currently an inert stored boolean with no consuming logic anywhere (docs/architecture-review-v2.md §H).',
    visibleToMatching: false,
    visibleToAi: false,
  },
  'ModerationFlag.textContent': {
    level: 'HIGHLY_SENSITIVE',
    enforcedBy:
      'AdminGuard-gated endpoints only (admin/moderation.controller.ts) — never returned to the flagged user or any other party.',
    visibleToMatching: false,
    visibleToAi: false,
  },
  'Message.content': {
    level: 'PRIVATE',
    enforcedBy:
      'ConversationAccessService.assertAccessible() — match-participant-only, never used as a matching/ranking signal.',
    visibleToMatching: false,
    visibleToAi: false,
  },
  'ProfileAttributeProvenance.*': {
    level: 'PRIVATE',
    enforcedBy:
      'No endpoint currently returns this table at all (FR-288) — backend-internal only until a product decision says otherwise.',
    visibleToMatching: false,
    visibleToAi: false,
  },
};

export function isVisibleToMatching(fieldKey: string): boolean {
  return DATA_CLASSIFICATION[fieldKey]?.visibleToMatching ?? false;
}

export function isVisibleToAi(fieldKey: string): boolean {
  return DATA_CLASSIFICATION[fieldKey]?.visibleToAi ?? false;
}
