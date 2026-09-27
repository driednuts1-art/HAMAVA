"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPreferences,
  updatePreferences,
  type DiscoveryPreferences,
} from "@/lib/queries/discovery";
import type { Gender, RelationshipGoal } from "@/lib/queries/profile";
import { SkeletonLine, ErrorState } from "@/components/page-states";
import { CloseIcon } from "@/components/icons";

const GENDER_VALUES: Gender[] = ["MALE", "FEMALE", "OTHER"];
const INTENT_VALUES: RelationshipGoal[] = [
  "SERIOUS",
  "CASUAL",
  "MARRIAGE_TRACK",
  "FRIENDSHIP",
  "NOT_SURE",
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * FR-267..FR-270. Deliberately no distance control (Feature 16 §1/§4,
 * docs/roadmap.md's Phase 2 entry) — the real backend has no such field.
 * genderPref/relationshipGoalPref are real multi-select (FR-268/269), a
 * deliberate superset of the source prototype's single-choice picker.
 */
export function FiltersPanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("discovery.filtersPanel");
  // Reuses profile.form's gender/intent option labels — same vocabulary,
  // not a second, potentially-drifting copy of the same English strings.
  const tForm = useTranslations("profile.form");
  const queryClient = useQueryClient();
  const prefsQuery = useQuery({
    queryKey: ["discovery-preferences"],
    queryFn: getPreferences,
  });

  // FR-267..FR-270: track only the *edits*, not a seeded copy of the fetch
  // — same pattern as Feature 15's ProfileForm (`patch` over `profile`), so
  // there's no effect syncing local state from an async query result.
  const [patch, setPatch] = useState<Partial<DiscoveryPreferences>>({});
  const draft: DiscoveryPreferences | null = prefsQuery.data
    ? { ...prefsQuery.data, ...patch }
    : null;

  const saveMutation = useMutation({
    mutationFn: (input: DiscoveryPreferences) => updatePreferences(input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["discovery-preferences"], updated);
      setPatch({});
      onSaved();
      onClose();
    },
  });

  const ageError = draft && draft.minAge > draft.maxAge ? t("invalidAgeRange") : undefined;

  function set<K extends keyof DiscoveryPreferences>(
    key: K,
    value: DiscoveryPreferences[K],
  ) {
    setPatch((p) => ({ ...p, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-[var(--bg-deep)]/70 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-elevation-3 sm:rounded-[var(--radius-lg-value)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{t("title")}</h2>
          <button type="button" aria-label={t("close")} onClick={onClose}>
            <CloseIcon className="h-5 w-5 text-[var(--text-muted)]" />
          </button>
        </div>

        {prefsQuery.isPending || !draft ? (
          <>
            <SkeletonLine className="h-8 w-full" />
            <SkeletonLine className="h-8 w-full" />
            <SkeletonLine className="h-8 w-full" />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-[var(--text-faint)]">
                {t("ageRange", { min: draft.minAge, max: draft.maxAge })}
              </span>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={18}
                  max={100}
                  value={draft.minAge}
                  aria-label={t("minAge")}
                  onChange={(e) => set("minAge", Number(e.target.value))}
                  className="w-full rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={18}
                  max={100}
                  value={draft.maxAge}
                  aria-label={t("maxAge")}
                  onChange={(e) => set("maxAge", Number(e.target.value))}
                  className="w-full rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </div>
              {ageError ? (
                <p role="alert" className="text-xs text-[var(--rose)]">
                  {ageError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-[var(--text-faint)]">{t("showMeLabel")}</span>
              <div className="flex flex-wrap gap-2">
                {GENDER_VALUES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={draft.genderPref.includes(v)}
                    onClick={() => set("genderPref", toggle(draft.genderPref, v))}
                    className={
                      "rounded-full px-3 py-1.5 text-xs font-bold " +
                      (draft.genderPref.includes(v)
                        ? "bg-[var(--turquoise)] text-[#04211f]"
                        : "bg-[var(--surface)] text-[var(--text-muted)]")
                    }
                  >
                    {tForm(`genderOptions.${v}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-[var(--text-faint)]">{t("relationshipGoalLabel")}</span>
              <div className="flex flex-wrap gap-2">
                {INTENT_VALUES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={draft.relationshipGoalPref.includes(v)}
                    onClick={() =>
                      set(
                        "relationshipGoalPref",
                        toggle(draft.relationshipGoalPref, v),
                      )
                    }
                    className={
                      "rounded-full px-3 py-1.5 text-xs font-bold " +
                      (draft.relationshipGoalPref.includes(v)
                        ? "bg-[var(--turquoise)] text-[#04211f]"
                        : "bg-[var(--surface)] text-[var(--text-muted)]")
                    }
                  >
                    {tForm(`intentOptions.${v}`)}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between">
              <span className="text-sm font-bold">{t("verifiedOnly")}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--turquoise)]"
                checked={draft.verifiedOnly}
                onChange={(e) => set("verifiedOnly", e.target.checked)}
                aria-label={t("verifiedOnly")}
              />
            </label>

            <label className="flex items-center justify-between">
              <span className="text-sm font-bold">{t("activeThisWeekOnly")}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--turquoise)]"
                checked={draft.activeThisWeekOnly}
                onChange={(e) => set("activeThisWeekOnly", e.target.checked)}
                aria-label={t("activeThisWeekOnly")}
              />
            </label>

            <label className="flex items-center justify-between">
              <span className="text-sm font-bold">{t("newMembersOnly")}</span>
              <input
                type="checkbox"
                className="h-5 w-5 accent-[var(--turquoise)]"
                checked={draft.newMembersOnly}
                onChange={(e) => set("newMembersOnly", e.target.checked)}
                aria-label={t("newMembersOnly")}
              />
            </label>

            <button
              type="button"
              disabled={saveMutation.isPending || Boolean(ageError)}
              onClick={() => saveMutation.mutate(draft)}
              className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
            >
              {saveMutation.isPending ? t("saving") : t("apply")}
            </button>
            {saveMutation.isError ? (
              <ErrorState onRetry={() => saveMutation.mutate(draft)} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
