import { Gender, RelationshipGoal } from '@prisma/client';

export const AI_SEARCH_EXTRACTION_PROVIDER = Symbol(
  'AI_SEARCH_EXTRACTION_PROVIDER',
);

/**
 * FR-104: structured filters extracted from a free-text prompt. Deliberately
 * has NO field capable of expressing "include unverified users" — FR-110's
 * verified-only floor is protected structurally, not by filtering this
 * output after the fact. Every field here is a real, existing filter
 * dimension (Feature 3's DiscoveryPreferences / Feature 2's `city`) — never
 * candidate/profile data, which is what makes FR-114's no-hallucination
 * guarantee true by construction.
 */
export interface ExtractedFilters {
  city: string | null;
  minAge: number | null;
  maxAge: number | null;
  gender: Gender[];
  relationshipGoal: RelationshipGoal[];
  /** Normalized free text fed to the embedding stage (FR-111). */
  semanticQuery: string;
}

export interface AiSearchExtractionProviderInterface {
  extractFilters(text: string): Promise<ExtractedFilters>;
}
