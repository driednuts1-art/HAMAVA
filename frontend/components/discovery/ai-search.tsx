"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import {
  extractTextFilters,
  transcribeVoiceFilters,
  runAiSearch,
  type AiSearchMode,
  type DeckCandidate,
  type ExtractedFilters,
} from "@/lib/queries/discovery";
import type { Gender, RelationshipGoal } from "@/lib/queries/profile";
import { ApiRequestError } from "@/lib/api-error";
import { useVoiceRecording } from "@/lib/hooks/use-voice-recording";
import { VoiceMicButton } from "@/components/voice-mic-button";
import { CandidateCard } from "@/components/discovery/candidate-card";
import { ErrorState, EmptyState, SkeletonLine } from "@/components/page-states";
import { SendIcon } from "@/components/icons";

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

interface DraftFilters extends ExtractedFilters {
  mode: AiSearchMode;
}

/**
 * FR-271..FR-278: text/voice prompt entry, the editable-filters confirm
 * step (mirroring Feature 15's proposal-card "AI proposes, human confirms"
 * pattern), then the real search. `verifiedOnly` is never shown here
 * (FR-275) — it structurally isn't part of AiSearchInput.
 */
export function AiPromptSearch({ onFallbackToDeck }: { onFallbackToDeck: () => void }) {
  const t = useTranslations("discovery.aiSearch");
  const tForm = useTranslations("profile.form");
  const [textDraft, setTextDraft] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFilters | null>(null);
  const [results, setResults] = useState<DeckCandidate[] | null>(null);

  const extractMutation = useMutation({
    mutationFn: (text: string) => extractTextFilters(text),
    onSuccess: (res) => {
      setTranscript(null);
      setDraft({ ...res.filters, mode: "TEXT" });
      setResults(null);
    },
  });

  const transcribeMutation = useMutation({
    mutationFn: (blob: Blob) => transcribeVoiceFilters(blob),
    onSuccess: (res) => {
      setTranscript(res.transcribedText);
      setDraft({ ...res.filters, mode: "VOICE" });
      setResults(null);
    },
  });

  const searchMutation = useMutation({
    mutationFn: (input: DraftFilters) =>
      runAiSearch({
        mode: input.mode,
        semanticQuery: input.semanticQuery,
        city: input.city ?? undefined,
        minAge: input.minAge ?? undefined,
        maxAge: input.maxAge ?? undefined,
        gender: input.gender,
        relationshipGoal: input.relationshipGoal,
      }),
    onSuccess: (page) => setResults(page.candidates),
  });

  const recording = useVoiceRecording(
    (blob) => transcribeMutation.mutate(blob),
    transcribeMutation.isPending,
  );

  const activeError =
    extractMutation.error ?? transcribeMutation.error ?? searchMutation.error;
  const vendorFailure =
    activeError instanceof ApiRequestError && activeError.problem.status === 503;
  const rateLimited =
    activeError instanceof ApiRequestError && activeError.problem.status === 429;

  // FR-277: a generic, user-facing Persian fallback message — never the
  // backend's raw (English, developer-diagnostic) detail text, regardless of
  // the specific vendor failure reason.
  if (vendorFailure) {
    return (
      <div className="flex flex-col items-center gap-3">
        <ErrorState
          title={t("unavailableTitle")}
          detail={t("unavailableDetail")}
        />
        <button
          type="button"
          onClick={onFallbackToDeck}
          className="rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f]"
        >
          {t("backToDeck")}
        </button>
      </div>
    );
  }

  if (draft) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        {transcript ? (
          <p className="rounded-[var(--radius-sm-value)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
            {t("transcribed", { text: transcript })}
          </p>
        ) : null}

        <div className="flex flex-col gap-3 rounded-[var(--radius-lg-value)] border border-[var(--turquoise)] bg-[var(--panel)] p-4">
          <p className="text-xs font-bold text-[var(--turquoise)]">
            {t("detectedFilters")}
          </p>

          <textarea
            value={draft.semanticQuery}
            onChange={(e) => setDraft({ ...draft, semanticQuery: e.target.value })}
            aria-label={t("searchDescriptionAriaLabel")}
            rows={2}
            className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          />

          <input
            type="text"
            value={draft.city ?? ""}
            onChange={(e) => setDraft({ ...draft, city: e.target.value || null })}
            aria-label={t("city")}
            placeholder={t("city")}
            className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
          />

          <div className="flex gap-2">
            <input
              type="number"
              min={18}
              max={100}
              value={draft.minAge ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, minAge: e.target.value ? Number(e.target.value) : null })
              }
              aria-label={t("minAge")}
              placeholder={t("minAge")}
              className="w-full rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={18}
              max={100}
              value={draft.maxAge ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, maxAge: e.target.value ? Number(e.target.value) : null })
              }
              aria-label={t("maxAge")}
              placeholder={t("maxAge")}
              className="w-full rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {GENDER_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={draft.gender.includes(v)}
                onClick={() => setDraft({ ...draft, gender: toggle(draft.gender, v) })}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-bold " +
                  (draft.gender.includes(v)
                    ? "bg-[var(--turquoise)] text-[#04211f]"
                    : "bg-[var(--surface)] text-[var(--text-muted)]")
                }
              >
                {tForm(`genderOptions.${v}`)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {INTENT_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={draft.relationshipGoal.includes(v)}
                onClick={() =>
                  setDraft({
                    ...draft,
                    relationshipGoal: toggle(draft.relationshipGoal, v),
                  })
                }
                className={
                  "rounded-full px-3 py-1.5 text-xs font-bold " +
                  (draft.relationshipGoal.includes(v)
                    ? "bg-[var(--turquoise)] text-[#04211f]"
                    : "bg-[var(--surface)] text-[var(--text-muted)]")
                }
              >
                {tForm(`intentOptions.${v}`)}
              </button>
            ))}
          </div>

          {rateLimited ? (
            <p role="alert" className="text-xs text-[var(--rose)]">
              {t("rateLimited")}
            </p>
          ) : null}

          <button
            type="button"
            disabled={searchMutation.isPending}
            onClick={() => searchMutation.mutate(draft)}
            className="rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
          >
            {searchMutation.isPending ? t("searching") : t("search")}
          </button>
        </div>

        {searchMutation.isPending ? (
          <SkeletonLine className="h-64 w-full rounded-[var(--radius-lg-value)]" />
        ) : results ? (
          results.length === 0 ? (
            <EmptyState
              title={t("noResultsTitle")}
              detail={t("noResultsDetail")}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {results.map((c) => (
                <CandidateCard key={c.id} candidate={c} />
              ))}
            </div>
          )
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-4">
        <textarea
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          maxLength={500}
          aria-label={t("inputAriaLabel")}
          placeholder={t("inputPlaceholder")}
          rows={3}
          className="w-full resize-none border-none bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </div>
      {rateLimited ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {t("rateLimited")}
        </p>
      ) : null}
      <div className="flex gap-2">
        <VoiceMicButton
          status={recording.status}
          hintVisible={recording.hintVisible}
          hintText={t("voiceHint")}
          onToggle={recording.toggle}
        />
        <button
          type="button"
          disabled={extractMutation.isPending || !textDraft.trim()}
          onClick={() => extractMutation.mutate(textDraft.trim())}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
        >
          <SendIcon className="h-4 w-4" />
          {extractMutation.isPending || transcribeMutation.isPending
            ? t("checking")
            : t("findWithAi")}
        </button>
      </div>
    </div>
  );
}
