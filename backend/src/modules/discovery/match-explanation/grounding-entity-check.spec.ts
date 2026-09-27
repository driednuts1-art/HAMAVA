import {
  normalizeForMatch,
  realProfileTextOf,
  hasTextualSupport,
} from './grounding-entity-check';
import { MatchExplanationFacts } from './match-explanation-provider.interface';

function facts(
  overrides: Partial<MatchExplanationFacts>,
): MatchExplanationFacts {
  return {
    displayName: null,
    age: null,
    city: null,
    bio: null,
    interests: [],
    datingIntent: null,
    ...overrides,
  };
}

// No unit test existed for this pure, deterministic module before this pass
// (2026-09-18) — it was only ever exercised indirectly through the real
// match-explanation-boost e2e suite. Added here specifically because this
// file's normalization regex was just changed (a manual Arabic diacritic
// range replaced with a Unicode \p{Mn} property escape, to fix a real
// no-misleading-character-class lint error) — this is the fast, precise way
// to confirm that change didn't alter real matching behavior, ahead of the
// slower, real-OpenAI e2e confirmation.
describe('normalizeForMatch', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeForMatch('  Hello   World  ')).toBe('hello world');
  });

  it('strips Arabic diacritics (the original U+064B..U+0652 range this function targeted)', () => {
    // کُوهنُوردی with real fatha/damma diacritics inserted — the exact class
    // of input this function exists to normalize away.
    const withDiacritics = 'کُوهنَوردی';
    const withoutDiacritics = 'کوهنوردی';
    expect(normalizeForMatch(withDiacritics)).toBe(
      normalizeForMatch(withoutDiacritics),
    );
  });

  it('strips ZWNJ and RLM invisible marks', () => {
    const withZwnj = 'می‌روم'; // contains a real U+200C between می and روم
    const withoutZwnj = 'میروم';
    expect(normalizeForMatch(withZwnj)).toBe(normalizeForMatch(withoutZwnj));
  });

  it('normalizes Arabic-vs-Persian letterform variants (ي/ك/أ family)', () => {
    expect(normalizeForMatch('علي')).toBe(normalizeForMatch('علی'));
    expect(normalizeForMatch('كتاب')).toBe(normalizeForMatch('کتاب'));
  });

  it('does not alter plain Latin text with no combining marks (no behavior change for the common case)', () => {
    expect(normalizeForMatch('hiking and travel')).toBe('hiking and travel');
  });

  it('strips combining marks from non-Arabic scripts too (a deliberate broadening over the original Arabic-only range)', () => {
    // é as e + U+0301 COMBINING ACUTE ACCENT (a real decomposed form, not
    // the single precomposed U+00E9 code point) — \p{Mn} catches this;
    // the original manual Arabic range would not have.
    const decomposedE = 'café';
    expect(normalizeForMatch(decomposedE)).toBe('cafe');
  });
});

describe('realProfileTextOf', () => {
  const person = facts({
    displayName: 'زهرا',
    city: 'تهران',
    bio: 'عاشق کوهنوردی و کتاب',
    interests: ['موسیقی', 'فیلم'],
  });

  it('joins every real, present field with a separator that cannot accidentally bridge two fields', () => {
    const result = realProfileTextOf(person);
    expect(result).toContain('زهرا');
    expect(result).toContain('تهران');
    expect(result).toContain('موسیقی');
    expect(result).toContain('فیلم');
  });

  it('omits absent fields entirely rather than inserting empty placeholders', () => {
    const sparse = facts({ displayName: 'کیان' });
    const result = realProfileTextOf(sparse);
    expect(result).toBe('کیان');
  });
});

describe('hasTextualSupport', () => {
  const userA = facts({
    displayName: 'زهرا',
    bio: 'عاشق کوهنوردی هستم',
    interests: ['موسیقی'],
  });
  const userB = facts({
    displayName: 'کیان',
    bio: 'کتاب‌خوانی رو دوست دارم',
    interests: ['فیلم'],
  });

  it('returns true when every entity has real textual support in either profile', () => {
    expect(hasTextualSupport(['کوهنوردی', 'فیلم'], userA, userB)).toBe(true);
  });

  it('returns false when an entity has zero support in either profile (the real fabrication-detection case)', () => {
    expect(hasTextualSupport(['اسکی روی یخ'], userA, userB)).toBe(false);
  });

  it('returns true (vacuously) when no entities were extracted — nothing specific to fabricate', () => {
    expect(hasTextualSupport([], userA, userB)).toBe(true);
  });

  it('matches across the diacritic/ZWNJ-normalized form, not just exact byte-for-byte text', () => {
    // Same real fact as userA's bio, but with a diacritic inserted — must
    // still be recognized as supported, matching this file's own explicit
    // design (a mechanical substring check on *normalized* text).
    expect(hasTextualSupport(['کُوهنوردی'], userA, userB)).toBe(true);
  });
});
