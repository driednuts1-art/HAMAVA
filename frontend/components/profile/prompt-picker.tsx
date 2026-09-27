"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { getPrompts, type PromptAnswer } from "@/lib/queries/profile";
import { SkeletonLine } from "@/components/page-states";
import { CloseIcon, PlusIcon } from "@/components/icons";

const MAX_ANSWERS = 3;
const MAX_ANSWER_LENGTH = 300;

/**
 * Feature 24 (FR-432..FR-436): 2-3 prompt answers picked from the fixed,
 * server-owned list (`GET /v1/profile/prompts`, prompts.constants.ts) — the
 * one real source of truth, never a hardcoded copy that could drift. 2
 * answers unlock profileCompletedAt (FR-435); a 3rd is optional depth.
 */
export function PromptPicker({
  value,
  onChange,
}: {
  value: PromptAnswer[];
  onChange: (next: PromptAnswer[]) => void;
}) {
  const t = useTranslations("profile.promptPicker");
  const promptsQuery = useQuery({
    queryKey: ["profile-prompts"],
    queryFn: getPrompts,
    staleTime: Infinity, // a fixed, server-owned list — no reason to ever refetch mid-session.
  });
  const [draftPromptId, setDraftPromptId] = useState("");

  if (promptsQuery.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <SkeletonLine className="h-8 w-full" />
        <SkeletonLine className="h-20 w-full" />
      </div>
    );
  }
  if (promptsQuery.isError || !promptsQuery.data) {
    return null; // fail-open: the rest of the form still works without prompts.
  }

  const prompts = promptsQuery.data;
  const promptById = new Map(prompts.map((p) => [p.id, p.question]));
  const usedIds = new Set(value.map((a) => a.promptId));
  const remaining = prompts.filter((p) => !usedIds.has(p.id));

  function setAnswer(promptId: string, answer: string) {
    onChange(value.map((a) => (a.promptId === promptId ? { ...a, answer } : a)));
  }

  function removeAnswer(promptId: string) {
    onChange(value.filter((a) => a.promptId !== promptId));
  }

  function addPrompt() {
    if (!draftPromptId || value.length >= MAX_ANSWERS) return;
    onChange([...value, { promptId: draftPromptId, answer: "" }]);
    setDraftPromptId("");
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-xs font-bold text-[var(--text-faint)]">
        {t("label", { count: value.length, max: MAX_ANSWERS })}
      </label>

      {value.map((a) => (
        <div
          key={a.promptId}
          className="flex flex-col gap-2 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] p-3 shadow-elevation-1"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-[var(--turquoise)]">
              {promptById.get(a.promptId) ?? a.promptId}
            </p>
            <button
              type="button"
              aria-label={t("removeQuestion")}
              onClick={() => removeAnswer(a.promptId)}
              className="shrink-0"
            >
              <CloseIcon className="h-4 w-4 text-[var(--text-muted)]" />
            </button>
          </div>
          <textarea
            value={a.answer}
            maxLength={MAX_ANSWER_LENGTH}
            onChange={(e) => setAnswer(a.promptId, e.target.value)}
            aria-label={promptById.get(a.promptId) ?? t("answer")}
            rows={2}
            className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]"
          />
        </div>
      ))}

      {value.length < MAX_ANSWERS && remaining.length > 0 ? (
        <div className="flex gap-2">
          <select
            value={draftPromptId}
            onChange={(e) => setDraftPromptId(e.target.value)}
            aria-label={t("addNewQuestion")}
            className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
          >
            <option value="" disabled>
              {t("choosePrompt")}
            </option>
            {remaining.map((p) => (
              <option key={p.id} value={p.id}>
                {p.question}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addPrompt}
            disabled={!draftPromptId}
            aria-label={t("addQuestion")}
            className="flex items-center justify-center rounded-[var(--radius-sm-value)] bg-[var(--surface)] px-3 disabled:opacity-40"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
