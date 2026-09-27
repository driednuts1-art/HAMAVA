/**
 * Feature 24 (docs/requirements.md FR-433): a fixed, curated list of real
 * personality prompts — the single source of truth both the real
 * `GET /v1/profile/prompts` endpoint and `UpdateProfileDto`'s own
 * `promptId` validation read from, so the two can never silently drift
 * (matching Feature 22's own "one fixed FAQ list" precedent). No admin UI,
 * no user-submitted prompts (docs/requirements.md Feature 24 §5) — editable
 * only by changing this file.
 */
export interface PromptDefinition {
  id: string;
  question: string;
}

export const PROMPTS: readonly PromptDefinition[] = [
  { id: 'best-night', question: 'My best night is when…' },
  { id: 'never-say-no-to', question: 'I never say no to…' },
  { id: 'weird-fact', question: 'A weird thing about me…' },
  { id: 'cant-live-without', question: "I can't live without…" },
  { id: 'perfect-sunday', question: 'A perfect Sunday for me is…' },
  { id: 'overreact-to', question: 'I overreact when…' },
  { id: 'green-flag', question: 'A trait that always wins me over…' },
  { id: 'quality-time', question: 'The best way to spend time together…' },
  { id: 'ask-me-about', question: 'Ask me about…' },
  {
    id: 'unpopular-opinion',
    question: 'An unpopular opinion I have…',
  },
] as const;

export const PROMPT_IDS: readonly string[] = PROMPTS.map((p) => p.id);

export function isRealPromptId(id: string): boolean {
  return PROMPT_IDS.includes(id);
}
