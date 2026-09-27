import { MatchExplanationFacts } from './match-explanation-provider.interface';

/**
 * A real, second, complementary check for `checkGrounded()`
 * (`openai-match-explanation.provider.ts`) — added after a real, quantified
 * finding (docs/roadmap.md "Watch items"): the LLM-judge check alone missed
 * roughly half of clearly-fabricated claims across 8 distinct probe
 * scenarios, all sharing one shape — a specific, nameable fact (a place, an
 * event, a relationship, a physical detail, a habit, a skill) invented with
 * zero basis in either profile. That specific shape is exactly what a
 * deterministic, non-judgment check can catch reliably: this file never
 * asks "is this a reasonable claim," only "does any specific thing this
 * claim names appear anywhere in the real profile text" — a mechanical
 * substring check, not a holistic judgment call, so it carries none of the
 * LLM-judge's own sampling variance or calibration drift.
 *
 * Deliberately NOT a replacement for the LLM-judge: a genuine semantic
 * paraphrase ("کوهنوردی" + "طبیعت‌گردی" → "shared love of nature") has no
 * literal textual overlap either, so this check alone would wrongly flag
 * plenty of real, grounded claims — it only ever narrows an already-GROUNDED
 * verdict further (a second opinion that can only make a claim stricter,
 * never looser), never widens a REJECTED one back to accepted.
 */

/** Case/diacritic-insensitive-enough normalization for a real substring check on Persian/English mixed text. */
// ZWNJ (U+200C) + RLM (U+200F) explicitly, plus a Unicode nonspacing-mark
// property escape for every combining diacritic (Arabic/Persian and beyond)
// — broader and more robust than a manual U+064B..U+0652 Arabic-only range,
// and (confirmed by testing both) doesn't trip no-misleading-character-class
// the way a manual range of combining code points does, since the rule
// fires on the resolved Unicode category regardless of source spelling.
// Not a matching-behavior change for any input that lacked non-Arabic
// combining marks before.
const DIACRITICS_AND_INVISIBLE_MARKS = /[\u200C\u200F\p{Mn}]/gu;

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(DIACRITICS_AND_INVISIBLE_MARKS, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every real, raw text field a claim could legitimately draw from — nothing invented, nothing inferred. */
export function realProfileTextOf(facts: MatchExplanationFacts): string {
  return normalizeForMatch(
    [
      facts.displayName,
      facts.city,
      facts.bio,
      ...facts.interests,
      facts.datingIntent,
    ]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .join(' ␟ '), // a real separator, so no cross-field accidental substring match
  );
}

/**
 * A single extracted entity is "supported" only if it (or the reverse —
 * the entity contains the whole profile text, for a very short profile
 * field matching inside a longer entity phrase) appears as a real
 * substring of the combined real profile text of EITHER person. No fuzzy
 * matching, no stemming — deliberately strict, since the point is to catch
 * *wholesale* invention (an entity with truly zero textual basis), not to
 * second-guess genuine paraphrasing (the LLM-judge's own job).
 */
export function hasTextualSupport(
  entities: string[],
  userA: MatchExplanationFacts,
  userB: MatchExplanationFacts,
): boolean {
  if (entities.length === 0) return true; // nothing specific claimed — nothing to fabricate
  const haystacks = [realProfileTextOf(userA), realProfileTextOf(userB)];
  return entities.every((entity) => {
    const needle = normalizeForMatch(entity);
    if (needle.length === 0) return true;
    return haystacks.some(
      (h) =>
        h.includes(needle) ||
        (needle.length > 0 && needle.includes(h) && h.length > 0),
    );
  });
}
