-- Hand-written, same reasoning as the immediately-preceding migration
-- (non-interactive shell). Restructures Swipe.aiExplanation (a single
-- string) into explanationReasons/explanationMismatches, mirroring the
-- Match.whyYouTwo -> matchReasons/matchMismatches change in the prior
-- migration exactly, for the same reason (Feature 21, docs/requirements.md).
-- One pre-existing test row had a non-null aiExplanation at the time of this
-- migration (checked directly, not assumed) — no production users exist yet
-- (docs/requirements.md Feature 21 §2), so this is a clean swap.

ALTER TABLE "swipes" DROP COLUMN "aiExplanation";
ALTER TABLE "swipes" ADD COLUMN "explanationReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "swipes" ADD COLUMN "explanationMismatches" TEXT[] DEFAULT ARRAY[]::TEXT[];
