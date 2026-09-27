"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { getProfile, PROFILE_QUERY_KEY } from "@/lib/queries/profile";
import { TabBar } from "@/components/layout/tab-bar";
import { useChatConnection, useCallListening } from "@/lib/hooks/use-chat-socket";
import { useCallStore } from "@/lib/call-store";
import { IncomingCallOverlay } from "@/components/calls/incoming-call-overlay";
import { InCallScreen } from "@/components/calls/in-call-screen";
import { WelcomeTour } from "@/components/onboarding/welcome-tour";
import { WelcomeTourErrorBoundary } from "@/components/onboarding/welcome-tour-error-boundary";

const CHAT_DETAIL_PATTERN = /^\/matches\/[^/]+$/;

// FR-308/310: the tab bar wraps Discover ("/"), Matches ("/matches"), and
// Profile ("/profile") — hidden on a conversation screen (its own focused,
// full-screen context) and before the profile is complete (matching the
// existing gate every page in this group already applies individually).
// FR-330: the app-wide WebSocket connection is opened here, once, not
// per-conversation. FR-345: so is the real call:incoming listener and its
// full-screen overlays — mounted here, not per-conversation, so an
// incoming call is caught from any tab.
export default function TabsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const setProfileCompleted = useAuthStore((s) => s.setProfileCompleted);
  const setWelcomeTourSeen = useAuthStore((s) => s.setWelcomeTourSeen);
  const callPhase = useCallStore((s) => s.phase);

  useChatConnection();
  useCallListening();

  // Real bug report (docs/requirements.md Feature 29 §11): every real
  // consumer of "is this profile complete" in this app — this file's own
  // showTabBar/WelcomeTour below, and app/(tabs)/page.tsx's discovery gate —
  // reads useAuthStore, not the `profile` react-query cache. That store was
  // previously synced only from ProfileForm's and ConversationalSetup's own
  // PATCH responses; PhotoGrid's independent photo upload (profile.service.ts
  // calls the exact same maybeMarkProfileCompleted() from that endpoint too)
  // could just as easily be the action that crosses the completion
  // threshold, and had no path back to the store at all — silently stuck
  // until a real page reload happened to re-run AuthRehydrator. Mounted here
  // (not in ProfilePage) so every tab this layout wraps benefits, not just
  // the one page that currently happens to render PhotoGrid — the same
  // "mount once, cover every screen" reasoning already used for the call
  // overlays and the tour itself below. Shares its cache entry with whatever
  // page-level `useQuery(PROFILE_QUERY_KEY, ...)` is also mounted (e.g.
  // ProfilePage's own), so this adds no extra network traffic beyond
  // reacting to invalidations that already happen.
  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getProfile,
    enabled: Boolean(user),
  });

  useEffect(() => {
    const profile = profileQuery.data;
    if (!profile || !user) return;
    // One-way only — raise, never lower. Both flags are genuinely "set
    // once" (maybeMarkProfileCompleted's own `if (profileCompletedAt)
    // return;`; WelcomeTour's dismiss is permanent by design), so a query
    // response can only ever confirm a flag the store doesn't have yet.
    // A real race found writing this very fix: WelcomeTour's own dismiss
    // mutation sets hasSeenWelcomeTour=true on the store directly without
    // invalidating this `profile` query — a bidirectional sync here would
    // then read the still-stale cached `false` on the next render and
    // immediately un-dismiss the tour it had just closed. Never demoting
    // true→false sidesteps that race entirely, and costs nothing: neither
    // flag is meant to ever go back to false while a session is live.
    if (profile.profileCompletedAt !== null && !user.profileCompleted) {
      setProfileCompleted(true);
    }
    if (profile.hasSeenWelcomeTour && !user.hasSeenWelcomeTour) {
      setWelcomeTourSeen(true);
    }
  }, [profileQuery.data, user, setProfileCompleted, setWelcomeTourSeen]);

  const showTabBar = Boolean(user?.profileCompleted) && !CHAT_DETAIL_PATTERN.test(pathname);

  return (
    <div className={showTabBar ? "pb-16" : undefined}>
      {children}
      {showTabBar ? <TabBar /> : null}
      {callPhase === "ringing-incoming" ? <IncomingCallOverlay /> : null}
      {callPhase !== "idle" && callPhase !== "ringing-incoming" ? <InCallScreen /> : null}
      {/* Feature 29 (FR-505): a real, durable "seen or not" check, not a
          live transition event — mounted here (not on any specific page)
          for the same reason the call overlays above are, so it shows
          regardless of which screen the user lands on after completing
          their profile. */}
      {user?.profileCompleted && !user.hasSeenWelcomeTour ? (
        <WelcomeTourErrorBoundary>
          <WelcomeTour />
        </WelcomeTourErrorBoundary>
      ) : null}
    </div>
  );
}
