"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, type AuthUser } from "@/lib/auth-store";
import { getProfile, PROFILE_QUERY_KEY, type Profile } from "@/lib/queries/profile";
import type { DeckCandidate } from "@/lib/queries/discovery";
import { BrandMark } from "@/components/brand-mark";
import { CandidateCard } from "@/components/discovery/candidate-card";
import { ProfileForm } from "@/components/profile/profile-form";
import { PhotoGrid } from "@/components/profile/photo-grid";
import { ConversationalSetup } from "@/components/profile/conversational-setup";
import { SkeletonLine, ErrorState } from "@/components/page-states";
import { ChatIcon, EditIcon } from "@/components/icons";

type Mode = "choice" | "manual" | "conversational";
type ViewMode = "view" | "edit";

// Feature 25 (FR-470): mirrors backend/src/common/age.util.ts's exact
// real/no-future-birthday age calculation — the same logic, kept in sync by
// hand since the frontend has no access to backend code. `birthDate` is
// always non-null here (the caller only builds this for a complete
// profile, and FR-20 already requires it for completeness).
function ageFromBirthDate(birthDateIso: string, now = new Date()): number {
  const birthDate = new Date(birthDateIso);
  let age = now.getFullYear() - birthDate.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > birthDate.getMonth() ||
    (now.getMonth() === birthDate.getMonth() &&
      now.getDate() >= birthDate.getDate());
  if (!hadBirthdayThisYear) age--;
  return age;
}

// Feature 25 (FR-470): the owner's own view of `/profile` reuses the exact
// same `CandidateCard` other users see of them (Feature 24's own
// already-established "one shared card" rule, §11 — not a second, bespoke
// preview component). `GET /v1/profile/me` (Profile) already carries every
// field `CandidateCard` needs except `id`/`verified`, which come from the
// auth store instead of a second fetch.
function toOwnCandidate(profile: Profile, user: AuthUser): DeckCandidate {
  return {
    id: user.id,
    displayName: profile.displayName,
    age: profile.birthDate ? ageFromBirthDate(profile.birthDate) : null,
    city: profile.city,
    bio: profile.bio,
    interests: profile.interests,
    verified: user.livenessStatus,
    photos: profile.photos,
    promptAnswers: profile.promptAnswers,
    height: profile.height,
    education: profile.education,
    exerciseHabit: profile.exerciseHabit,
    hasKids: profile.hasKids,
    zodiacSign: profile.zodiacSign,
    politicalView: profile.politicalView,
    hometown: profile.hometown,
    languages: profile.languages,
    drinking: profile.drinking,
    smoking: profile.smoking,
    // Feature 27: not meaningful on your own view-mode card — no "new
    // member" badge and no presence dot for yourself.
    isNewMember: false,
    presence: null,
  };
}

// FR-225..FR-227 (Feature 15), FR-256 (Feature 16 — moved from "/", which
// is now the discovery screen once complete): the completeness gate reads
// straight from useAuthStore, no fetch of its own.
// FR-308: the "back to discovery" link that used to live here (FR-258) is
// superseded by Feature 17's persistent tab bar (app/(tabs)/layout.tsx).
export default function ProfilePage() {
  const t = useTranslations("profile.page");
  const user = useAuthStore((s) => s.user);
  const [mode, setMode] = useState<Mode>("choice");
  // Feature 25 (FR-473): purely local UI state, not a route or persisted
  // preference — a fresh visit to a complete profile always starts in view
  // mode, matching FR-473's own explicit requirement.
  const [viewMode, setViewMode] = useState<ViewMode>("view");
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getProfile,
  });

  function refetchProfile() {
    return queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
  }

  if (profileQuery.isPending) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
        <SkeletonLine className="h-14 w-14 rounded-full" />
        <SkeletonLine className="h-6 w-40" />
        <SkeletonLine className="h-32 w-full max-w-md" />
      </main>
    );
  }

  if (profileQuery.isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6">
        <ErrorState onRetry={() => profileQuery.refetch()} />
      </main>
    );
  }

  const profile = profileQuery.data;
  const isComplete = user?.profileCompleted ?? profile.profileCompletedAt !== null;

  // Feature 25 (FR-470/471): the owner's default view of a complete profile
  // is the same real CandidateCard other users see, not the edit form
  // directly — `user` is required to build it (id/verified come from the
  // auth store, not GET /v1/profile/me); the rare case it's not yet
  // populated falls through to the edit form below rather than crashing.
  // `mode === "choice"` is required too: a real regression found running
  // the existing e2e suite — without it, a profile that becomes complete
  // *mid-onboarding* (still in "manual"/"conversational" mode, e.g. the
  // photo upload that finally satisfies FR-227) would yank the user
  // straight into read-only view mode the instant `isComplete` flips,
  // replacing the very form they're actively using. `mode` only stays
  // "choice" for a profile that was already complete when this page
  // mounted — exactly the case FR-470 means to cover — never once the user
  // has entered either onboarding path this session.
  if (isComplete && mode === "choice" && viewMode === "view" && user) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-6 px-6 py-16">
        <BrandMark size={56} />
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-[-0.01em]">
          <EditIcon className="h-5 w-5" />
          {t("myProfile")}
        </h1>
        <CandidateCard candidate={toOwnCandidate(profile, user)} />
        <button
          type="button"
          onClick={() => setViewMode("edit")}
          className="flex items-center justify-center gap-2 rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
        >
          <EditIcon className="h-4 w-4" />
          {t("editProfile")}
        </button>
      </main>
    );
  }

  // The same `mode === "choice"` guard as the branch above, and for the
  // same reason — extended here after a real regression found running
  // profile.spec.ts (docs/requirements.md Feature 29 §11's own layout.tsx
  // fix): once useAuthStore's `profileCompleted` started flipping live,
  // mid-session (no reload required — the whole point of that fix), this
  // branch's structurally different JSX (an <h1> here vs. the "manual" mode
  // branch below's bare Fragment) made React tear down and remount
  // PhotoGrid/ProfileForm the instant a photo upload crossed the completion
  // threshold — wiping PhotoGrid's own just-set "عکس اضافه شد." success
  // state (and, more seriously, would have wiped any in-progress
  // ProfileForm `patch` too) out from under the user mid-edit. Before this
  // fix, isComplete only ever became true via a full page reload, so this
  // branch's fresh mount was indistinguishable from any other fresh page
  // load — a latent gap the reload always happened to paper over.
  if (isComplete && mode === "choice") {
    return (
      <main className="flex min-h-screen flex-col items-center gap-8 px-6 py-16">
        <BrandMark size={56} />
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-[-0.01em]">
          <EditIcon className="h-5 w-5" />
          {t("myProfile")}
        </h1>
        <PhotoGrid photos={profile.photos} onChanged={refetchProfile} />
        <ProfileForm
          profile={profile}
          // Feature 25 (FR-472): a real successful save returns to view
          // mode — refetch first so view mode renders the just-saved data,
          // not a stale cached read.
          onSaved={async () => {
            await refetchProfile();
            setViewMode("view");
          }}
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16">
      <BrandMark size={56} />
      {mode === "choice" ? (
        <div className="flex w-full max-w-sm flex-col gap-4">
          <h1 className="text-center text-2xl font-extrabold tracking-[-0.01em]">
            {t("letsBuildProfile")}
          </h1>
          <p className="text-center text-sm text-[var(--text-muted)]">
            {t("chooseOneOfTwo")}
          </p>
          <button
            type="button"
            onClick={() => setMode("conversational")}
            className="flex items-center justify-center gap-2 rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
          >
            <ChatIcon className="h-4 w-4" />
            {t("chatWithAi")}
          </button>
          <button
            type="button"
            onClick={() => setMode("manual")}
            className="flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] px-4 py-3 font-extrabold text-[var(--text)] shadow-elevation-1"
          >
            <EditIcon className="h-4 w-4" />
            {t("manualForm")}
          </button>
        </div>
      ) : mode === "conversational" ? (
        <ConversationalSetup
          onCompleted={refetchProfile}
          onSwitchToManual={() => setMode("manual")}
        />
      ) : (
        <>
          <PhotoGrid photos={profile.photos} onChanged={refetchProfile} />
          <ProfileForm profile={profile} onSaved={refetchProfile} />
        </>
      )}
    </main>
  );
}
