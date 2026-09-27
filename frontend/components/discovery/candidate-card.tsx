"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import type { DeckCandidate } from "@/lib/queries/discovery";
import { getPrompts } from "@/lib/queries/profile";
import {
  DumbbellIcon,
  FamilyIcon,
  GlassIcon,
  GlobeIcon,
  GraduationIcon,
  HeartFilledIcon,
  CigaretteIcon,
  RulerIcon,
  StarFilledIcon,
  VerifiedIcon,
  ZodiacIcon,
} from "@/components/icons";
import { EmptyState } from "@/components/page-states";
import { PresenceDot, formatPresenceLabel } from "@/components/presence-indicator";
import {
  getDrinkingOptions,
  getEducationOptions,
  getExerciseOptions,
  getKidsOptions,
  getSmokingOptions,
  getZodiacOptions,
} from "@/components/profile/about-me-fields";

function labelOf<T extends string>(
  options: { value: T; label: string }[],
  value: T | null,
): string | null {
  return options.find((o) => o.value === value)?.label ?? null;
}

/** FR-453: a compact icon+label chip, only rendered for fields the candidate actually filled in. */
function AboutMeChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1 rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-muted)]">
      {icon}
      {label}
    </span>
  );
}

/**
 * FR-260/261/276: one shared card for both the normal deck and AI-search
 * results — "a candidate" has exactly one visual language regardless of how
 * they were found. Verified badge uses design-system.md §4.2's real
 * signature-gradient photo frame, not a generic badge.
 */
export function CandidateCard({ candidate }: { candidate: DeckCandidate }) {
  const t = useTranslations("discovery.candidateCard");
  const tAboutMe = useTranslations("profile.aboutMe");
  const [photoIndex, setPhotoIndex] = useState(0);
  const photos = candidate.photos.slice().sort((a, b) => a.position - b.position);
  const activePhoto = photos[photoIndex];
  // Same query key as prompt-picker.tsx — React Query dedupes this to one
  // real network call no matter how many cards are on screen at once.
  const promptsQuery = useQuery({
    queryKey: ["profile-prompts"],
    queryFn: getPrompts,
    staleTime: Infinity,
  });
  const promptQuestion = (promptId: string) =>
    promptsQuery.data?.find((p) => p.id === promptId)?.question ?? null;
  const presenceLabel = formatPresenceLabel(candidate.presence);

  return (
    <div className="flex w-full max-w-sm flex-col overflow-hidden rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] shadow-elevation-2">
      <div
        className="relative aspect-[3/4] w-full overflow-hidden"
        style={
          candidate.verified
            ? { padding: 3, background: "var(--signature-gradient)" }
            : undefined
        }
      >
        <div
          className="relative h-full w-full overflow-hidden"
          style={{ borderRadius: "calc(var(--radius-lg-value) - 3px)" }}
        >
          {activePhoto ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a
               freshly-signed, short-lived S3 URL (Feature 2 FR-89), same
               reasoning as Feature 15's photo-grid.tsx. */
            <img
              src={activePhoto.url}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[var(--surface)]">
              <EmptyState title={t("noPhoto")} />
            </div>
          )}

          {/* Feature 27 (FR-487/FR-488): a live presence dot, top corner of
              the photo — the closest analog this card has to "on the
              avatar," since the photo itself is the whole card's avatar. */}
          <PresenceDot presence={candidate.presence} className="absolute top-3 start-3 h-3 w-3" />

          {/* FR-261: tap zones + a real segment bar, matching the source
              prototype's own photo-cycling convention. */}
          {photos.length > 1 ? (
            <>
              <div className="absolute inset-y-0 right-0 flex gap-1 p-2">
                {photos.map((p, i) => (
                  <div
                    key={p.id}
                    className={
                      "h-1 flex-1 rounded-full " +
                      (i === photoIndex ? "bg-[var(--turquoise)]" : "bg-white/30")
                    }
                    style={{ width: `${100 / photos.length}%` }}
                  />
                ))}
              </div>
              <button
                type="button"
                aria-label={t("previousPhoto")}
                onClick={() => setPhotoIndex((i) => Math.max(i - 1, 0))}
                className="absolute inset-y-0 right-0 w-1/2"
              />
              <button
                type="button"
                aria-label={t("nextPhoto")}
                onClick={() =>
                  setPhotoIndex((i) => Math.min(i + 1, photos.length - 1))
                }
                className="absolute inset-y-0 left-0 w-1/2"
              />
            </>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[var(--bg-deep)] to-transparent" />
          <div className="absolute bottom-3 right-4 left-4 flex items-center gap-2">
            <h3 className="text-lg font-extrabold text-white">
              {candidate.displayName ?? t("noName")}
              {candidate.age ? `, ${candidate.age}` : ""}
            </h3>
            {/* Feature 27 (FR-487): only the offline/last-active text lives
                here — the "online now" state is the dot above, not repeated
                as text. */}
            {presenceLabel && !candidate.presence?.online ? (
              <span className="text-xs font-bold text-white/70">
                {presenceLabel}
              </span>
            ) : null}
            {candidate.isNewMember ? (
              <span className="flex items-center rounded-full bg-[var(--turquoise)] px-2 py-0.5 text-[10px] font-extrabold text-[#04211f]">
                {t("newBadge")}
              </span>
            ) : null}
            {candidate.verified ? (
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full"
                style={{ background: "var(--signature-gradient)" }}
              >
                <VerifiedIcon className="h-3 w-3 text-[#04211f]" />
              </span>
            ) : null}
            {/* Feature 24 (FR-456): only set on a Who Liked Me card — shows
                whether this person liked or super-liked the viewer. */}
            {candidate.likedWith ? (
              <span
                className={
                  "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold " +
                  (candidate.likedWith === "SUPER_LIKE"
                    ? "bg-[var(--gold)] text-[#3a2a08]"
                    : "bg-[var(--rose)] text-[#2c0d16]")
                }
              >
                {candidate.likedWith === "SUPER_LIKE" ? (
                  <StarFilledIcon className="h-2.5 w-2.5" />
                ) : (
                  <HeartFilledIcon className="h-2.5 w-2.5" />
                )}
                {candidate.likedWith === "SUPER_LIKE" ? t("superLikedYou") : t("likedYou")}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {candidate.city || candidate.hometown ? (
          <p className="text-xs font-bold text-[var(--turquoise)]">
            {candidate.city ? t("livesIn", { city: candidate.city }) : null}
            {candidate.city && candidate.hometown ? " · " : null}
            {candidate.hometown ? t("fromHometown", { hometown: candidate.hometown }) : null}
          </p>
        ) : null}
        {candidate.bio ? (
          <p className="text-sm text-[var(--text-muted)]">{candidate.bio}</p>
        ) : null}
        {candidate.interests.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {candidate.interests.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-muted)]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {/* FR-453: the "about me" tag row — icon+label chips, only for
            fields this candidate actually filled in. */}
        {(() => {
          const chips: { key: string; icon: React.ReactNode; label: string }[] = [];
          if (candidate.height) {
            chips.push({
              key: "height",
              icon: <RulerIcon className="h-3 w-3" />,
              label: t("heightCm", { height: candidate.height }),
            });
          }
          const education = labelOf(getEducationOptions(tAboutMe), candidate.education);
          if (education) {
            chips.push({ key: "education", icon: <GraduationIcon className="h-3 w-3" />, label: education });
          }
          const exercise = labelOf(getExerciseOptions(tAboutMe), candidate.exerciseHabit);
          if (exercise) {
            chips.push({ key: "exercise", icon: <DumbbellIcon className="h-3 w-3" />, label: t("exercisePrefix", { value: exercise }) });
          }
          const kids = labelOf(getKidsOptions(tAboutMe), candidate.hasKids);
          if (kids) {
            chips.push({ key: "kids", icon: <FamilyIcon className="h-3 w-3" />, label: kids });
          }
          const zodiac = labelOf(getZodiacOptions(tAboutMe), candidate.zodiacSign);
          if (zodiac) {
            chips.push({ key: "zodiac", icon: <ZodiacIcon className="h-3 w-3" />, label: zodiac });
          }
          if (candidate.languages.length > 0) {
            chips.push({
              key: "languages",
              icon: <GlobeIcon className="h-3 w-3" />,
              label: candidate.languages.join(", "),
            });
          }
          // FR-451: already null server-side when the candidate hid this
          // category — nothing extra to check here.
          const drinking = labelOf(getDrinkingOptions(tAboutMe), candidate.drinking);
          if (drinking) {
            chips.push({ key: "drinking", icon: <GlassIcon className="h-3 w-3" />, label: t("drinkingPrefix", { value: drinking }) });
          }
          const smoking = labelOf(getSmokingOptions(tAboutMe), candidate.smoking);
          if (smoking) {
            chips.push({ key: "smoking", icon: <CigaretteIcon className="h-3 w-3" />, label: t("smokingPrefix", { value: smoking }) });
          }
          return chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <AboutMeChip key={c.key} icon={c.icon} label={c.label} />
              ))}
            </div>
          ) : null;
        })()}

        {/* FR-454: the first prompt answer, Bumble-style — the one piece of
            profile depth given its own visual weight, not just another chip. */}
        {candidate.promptAnswers.length > 0 ? (
          <div className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-xs font-bold text-[var(--turquoise)]">
              {promptQuestion(candidate.promptAnswers[0].promptId) ??
                candidate.promptAnswers[0].promptId}
            </p>
            <p className="mt-1 text-sm text-[var(--text)]">
              {candidate.promptAnswers[0].answer}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
