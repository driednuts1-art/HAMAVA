import { Prisma } from '@prisma/client';

/**
 * Feature 24 (docs/requirements.md FR-453): the real profile-depth display
 * fields, shared by every place that builds a `DeckCandidate` — the deck
 * (`deck.service.ts`), AI Search (`ai-search.service.ts`), and Who Liked Me
 * (`who-liked-me.service.ts`) — so this mapping (and FR-451's
 * hideDrinkingSmoking enforcement) has exactly one implementation, not three
 * that could silently drift.
 */
export interface CandidateProfileFields {
  promptAnswers: { promptId: string; answer: string }[];
  height: number | null;
  education: string | null;
  exerciseHabit: string | null;
  hasKids: string | null;
  zodiacSign: string | null;
  politicalView: string | null;
  hometown: string | null;
  languages: string[];
  drinking: string | null;
  smoking: string | null;
}

// The exact scalar fields this helper reads — every real call site selects
// (or, via a bare findMany with no `select`, already includes) at least these.
export type CandidateProfileFieldsSource = Prisma.UserGetPayload<{
  select: {
    promptAnswers: true;
    height: true;
    education: true;
    exerciseHabit: true;
    hasKids: true;
    zodiacSign: true;
    politicalView: true;
    hometown: true;
    languages: true;
    drinking: true;
    smoking: true;
    hideDrinkingSmoking: true;
  };
}>;

/**
 * FR-451: `hideDrinkingSmoking` hides the whole category — never just an
 * empty value — from every *other* viewer's read of this candidate. The
 * candidate's own `GET /v1/profile/me` (ProfileService.getProfile) is a
 * separate code path that never calls this helper, so the real underlying
 * values stay visible to their own owner regardless of this flag.
 */
export function buildCandidateProfileFields(
  user: CandidateProfileFieldsSource,
): CandidateProfileFields {
  return {
    promptAnswers: (user.promptAnswers ?? []) as {
      promptId: string;
      answer: string;
    }[],
    height: user.height,
    education: user.education,
    exerciseHabit: user.exerciseHabit,
    hasKids: user.hasKids,
    zodiacSign: user.zodiacSign,
    politicalView: user.politicalView,
    hometown: user.hometown,
    languages: user.languages,
    drinking: user.hideDrinkingSmoking ? null : user.drinking,
    smoking: user.hideDrinkingSmoking ? null : user.smoking,
  };
}
