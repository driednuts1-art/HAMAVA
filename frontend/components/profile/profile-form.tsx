"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import {
  updateProfile,
  type Profile,
  type Gender,
  type RelationshipGoal,
  type PromptAnswer,
} from "@/lib/queries/profile";
import { ApiRequestError } from "@/lib/api-error";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import { ErrorState } from "@/components/page-states";
import { BirthDateField } from "@/components/profile/birth-date-field";
import { TagInput } from "@/components/profile/tag-input";
import { PromptPicker } from "@/components/profile/prompt-picker";
import { AboutMeFields, type AboutMeValues } from "@/components/profile/about-me-fields";
import { useAuthStore } from "@/lib/auth-store";

const GENDER_VALUES: Gender[] = ["MALE", "FEMALE", "OTHER"];
const INTENT_VALUES: RelationshipGoal[] = [
  "SERIOUS",
  "CASUAL",
  "MARRIAGE_TRACK",
  "FRIENDSHIP",
  "NOT_SURE",
];

/**
 * FR-228..FR-233: the manual form. Only changed fields are ever submitted
 * (FR-232) — this component tracks a `patch` object of edits, not a full
 * copy of the profile, so an untouched field never gets re-sent.
 */
export function ProfileForm({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (updated: Profile) => void;
}) {
  const t = useTranslations("profile.form");
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const setProfileCompleted = useAuthStore((s) => s.setProfileCompleted);
  const setWelcomeTourSeen = useAuthStore((s) => s.setWelcomeTourSeen);

  const displayName = (patch.displayName as string) ?? profile.displayName ?? "";
  const birthDate = (patch.birthDate as string) ?? profile.birthDate;
  const city = (patch.city as string) ?? profile.city ?? "";
  const bio = (patch.bio as string) ?? profile.bio ?? "";
  const interests = (patch.interests as string[]) ?? profile.interests;
  const gender = (patch.gender as Gender) ?? profile.gender ?? "";
  const datingIntent =
    (patch.datingIntent as RelationshipGoal) ?? profile.datingIntent ?? "";
  const promptAnswers =
    (patch.promptAnswers as PromptAnswer[]) ?? profile.promptAnswers;
  const aboutMe: AboutMeValues = {
    height: (patch.height as number | null | undefined) ?? profile.height,
    education: (patch.education as AboutMeValues["education"]) ?? profile.education ?? "",
    exerciseHabit:
      (patch.exerciseHabit as AboutMeValues["exerciseHabit"]) ?? profile.exerciseHabit ?? "",
    hasKids: (patch.hasKids as AboutMeValues["hasKids"]) ?? profile.hasKids ?? "",
    zodiacSign: (patch.zodiacSign as AboutMeValues["zodiacSign"]) ?? profile.zodiacSign ?? "",
    politicalView:
      (patch.politicalView as AboutMeValues["politicalView"]) ?? profile.politicalView ?? "",
    hometown: (patch.hometown as string) ?? profile.hometown ?? "",
    languages: (patch.languages as string[]) ?? profile.languages,
    drinking: (patch.drinking as AboutMeValues["drinking"]) ?? profile.drinking ?? "",
    smoking: (patch.smoking as AboutMeValues["smoking"]) ?? profile.smoking ?? "",
    hideDrinkingSmoking:
      (patch.hideDrinkingSmoking as boolean) ?? profile.hideDrinkingSmoking,
  };

  const mutation = useMutation({
    mutationFn: () => updateProfile(patch),
    onSuccess: (updated) => {
      // FR-233: re-render from the real response, not local state.
      setPatch({});
      setProfileCompleted(updated.profileCompletedAt !== null);
      // Feature 29: keeps the store's copy accurate on every save, not just
      // at first completion (e.g. a later edit after the tour was already
      // dismissed must not accidentally reset it).
      setWelcomeTourSeen(updated.hasSeenWelcomeTour);
      onSaved(updated);
    },
  });

  const fieldError =
    mutation.error instanceof ApiRequestError ? mutation.error.problem.field : undefined;
  // Real, expected field-level validation details (birthDate/bio below) —
  // these are legitimate 400s the backend already writes user-facing text
  // for, not the raw-unexpected-detail bug class, so they stay as-is.
  const errorDetail =
    mutation.error instanceof ApiRequestError ? mutation.error.problem.detail : undefined;
  // Same real bug/fix as elsewhere (docs/roadmap.md), but only for the
  // generic non-field-specific fallback below — already safely gated by
  // `mutation.isError && !fieldError` at the JSX level (not by this value's
  // own truthiness), so no extra `.isError` guard is needed here.
  const genericErrorDetail = getSafeErrorMessage(mutation.error, []).detail;

  function set<K extends string>(key: K, value: unknown) {
    setPatch((p) => ({ ...p, [key]: value }));
  }

  // UpdateProfileDto has no "clear this enum" semantics (FR-437..FR-443,
  // FR-448/449 are additive depth, not a value that can be unset once
  // chosen) — so an empty ("not set") *enum* select is never sent, only a
  // real chosen one. hometown/languages/hideDrinkingSmoking have no such
  // restriction and pass through unconditionally.
  const ENUM_ABOUT_ME_KEYS = new Set<keyof AboutMeValues>([
    "education",
    "exerciseHabit",
    "hasKids",
    "zodiacSign",
    "politicalView",
    "drinking",
    "smoking",
  ]);
  function setAboutMe<K extends keyof AboutMeValues>(key: K, value: AboutMeValues[K]) {
    if (value === "" && ENUM_ABOUT_ME_KEYS.has(key)) return;
    set(key, value);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="flex w-full max-w-md flex-col gap-5"
    >
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-[var(--text-faint)]">{t("name")}</label>
        <input
          type="text"
          maxLength={50}
          value={displayName}
          onChange={(e) => set("displayName", e.target.value)}
          aria-label={t("name")}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-elevation-1 outline-none focus-visible:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]"
        />
      </div>

      <BirthDateField
        value={birthDate}
        onChange={(iso) => set("birthDate", iso)}
        error={fieldError === "birthDate" ? errorDetail : undefined}
      />

      <div className="flex flex-col gap-2">
        {/* FR-444/445: two-part location — "current city" (this field, the
            real technical `city` used by discovery filtering) vs "hometown"
            (`hometown`, part of AboutMeFields below) — the exact real
            relabeling FR-445 specifies, a real distinction for this app's
            diaspora-origin audience, not decorative. */}
        <label className="text-xs font-bold text-[var(--text-faint)]">{t("currentCity")}</label>
        <input
          type="text"
          maxLength={100}
          value={city}
          onChange={(e) => set("city", e.target.value)}
          aria-label={t("currentCity")}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-elevation-1 outline-none focus-visible:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-[var(--text-faint)]">{t("aboutMe")}</label>
        <textarea
          maxLength={500}
          value={bio}
          onChange={(e) => set("bio", e.target.value)}
          aria-label={t("aboutMe")}
          rows={4}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-elevation-1 outline-none focus-visible:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]"
        />
        {fieldError === "bio" ? (
          <p role="alert" className="text-xs text-[var(--rose)]">
            {errorDetail}
          </p>
        ) : null}
      </div>

      <TagInput value={interests} onChange={(next) => set("interests", next)} />

      <PromptPicker
        value={promptAnswers}
        onChange={(next) => set("promptAnswers", next)}
      />

      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-[var(--text-faint)]">{t("gender")}</label>
        <select
          value={gender}
          onChange={(e) => set("gender", e.target.value)}
          aria-label={t("gender")}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-elevation-1 outline-none focus-visible:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]"
        >
          <option value="" disabled>
            {t("choose")}
          </option>
          {GENDER_VALUES.map((v) => (
            <option key={v} value={v}>
              {t(`genderOptions.${v}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold text-[var(--text-faint)]">{t("datingGoal")}</label>
        <select
          value={datingIntent}
          onChange={(e) => set("datingIntent", e.target.value)}
          aria-label={t("datingGoal")}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-elevation-1 outline-none focus-visible:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]"
        >
          <option value="" disabled>
            {t("choose")}
          </option>
          {INTENT_VALUES.map((v) => (
            <option key={v} value={v}>
              {t(`intentOptions.${v}`)}
            </option>
          ))}
        </select>
      </div>

      <AboutMeFields values={aboutMe} onChange={setAboutMe} />

      {mutation.isError && !fieldError ? (
        <ErrorState detail={genericErrorDetail} onRetry={() => mutation.mutate()} />
      ) : null}

      <button
        type="submit"
        disabled={mutation.isPending || Object.keys(patch).length === 0}
        className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
      >
        {mutation.isPending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
