import { MessagingPermission, Prisma } from '@prisma/client';

/**
 * The hard safety exclusions every candidate-facing query in Discovery must
 * apply: never the caller themselves, never an incomplete profile, never
 * someone already swiped on in either direction (FR-38), never someone
 * blocked in either direction (FR-67), and the FR-79 messaging-permission
 * gate for unverified viewers. Shared by `DeckService.getDeck()` (Feature 3)
 * and `AiSearchService` (Feature 9, FR-109) so this logic has exactly one
 * implementation — extending it here extends both callers at once, and a
 * bug fixed here is fixed everywhere.
 *
 * Deliberately does NOT include the age/gender/relationship-goal/verified-only
 * preference filters — those come from a different source depending on the
 * caller (Feature 3's `DiscoveryPreferences`, or Feature 9's confirmed
 * extraction + the caller's own `verifiedOnly` toggle, never from a prompt —
 * see FR-110), so they stay call-site-specific rather than folded in here.
 */
export function buildSafetyExclusionWhere(
  userId: string,
  viewerLivenessStatus: boolean,
): Prisma.UserWhereInput {
  return {
    id: { not: userId },
    profileCompletedAt: { not: null }, // FR-37
    swipesReceived: { none: { actorId: userId } }, // FR-38
    // FR-67: bidirectional — a block in either direction excludes the pair
    // from each other's deck, so a blocked pair can never match again.
    blocksMade: { none: { blockedId: userId } },
    blocksReceived: { none: { blockerId: userId } },
    // FR-79: a candidate restricted to VERIFIED_ONLY never appears to an
    // unverified viewer — prevents the match (and any ability to message)
    // from forming at all, not just a checked-only-at-send-time restriction.
    ...(viewerLivenessStatus
      ? {}
      : { messagingPermission: MessagingPermission.EVERYONE }),
  };
}
