"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PlusIcon, CloseIcon } from "@/components/icons";

// FR-230: a real tag-input, not a comma-separated text field — the 10-item
// cap is enforced here, in the UI itself, not only on submit.
export function TagInput({
  value,
  onChange,
  max = 10,
  maxTagLength = 30,
  label,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  maxTagLength?: number;
  label?: string;
}) {
  const t = useTranslations("profile.tagInput");
  const [draft, setDraft] = useState("");

  function addTag() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed.length > maxTagLength) return;
    if (value.includes(trimmed) || value.length >= max) return;
    onChange([...value, trimmed]);
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold text-[var(--text-faint)]">
        {label ?? t("defaultLabel")} ({value.length}/{max})
      </label>
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-[var(--turquoise-dim)] px-3 py-1 text-xs font-bold text-[var(--turquoise)]"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={t("removeTag", { tag })}
              className="flex items-center"
            >
              <CloseIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {value.length < max ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            maxLength={maxTagLength}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            aria-label={t("addAriaLabel")}
            className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
          />
          <button
            type="button"
            onClick={addTag}
            disabled={!draft.trim()}
            aria-label={t("add")}
            className="flex items-center justify-center rounded-[var(--radius-sm-value)] bg-[var(--surface)] px-3 disabled:opacity-40"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
