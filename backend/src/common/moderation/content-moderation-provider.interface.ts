export const CONTENT_MODERATION_PROVIDER = Symbol(
  'CONTENT_MODERATION_PROVIDER',
);

export interface ModerationResult {
  approved: boolean;
  reason?: string;
}

/**
 * Abstraction over image (nudity/violence) and text (harassment) moderation
 * classifiers (product.md §8.5). Shared across every free-text/image surface
 * in the app (profile fields, chat messages — "no field is exempt", per
 * Feature 2's requirements.md) rather than each feature binding its own
 * copy. Real since Feature 8 (OpenAI Moderation API) — every rejection is
 * retained as a `ModerationFlag` for human review (docs/requirements.md
 * Feature 8), and automated results here still never drive account-level
 * actions on their own (product.md §8.5's explicit rule).
 */
export interface ContentModerationProviderInterface {
  moderateImage(data: Buffer): Promise<ModerationResult>;
  moderateText(text: string): Promise<ModerationResult>;
}
