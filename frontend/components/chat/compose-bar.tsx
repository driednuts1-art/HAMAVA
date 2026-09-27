"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { SendIcon } from "@/components/icons";

const MAX_LENGTH = 2000;
const WARN_THRESHOLD = MAX_LENGTH * 0.9;

// FR-323/328: bounded to the exact backend limit, a real remaining-count
// indicator once close to it (mirroring Feature 15's bio-field convention).
export function ComposeBar({
  onSend,
  disabled,
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("chat.composeBar");
  // Reuses the same "Message"/"Send" vocabulary as the conversational-setup
  // chat input, not a second, drifting copy of the same English words.
  const tCommon = useTranslations("profile.conversationalSetup");
  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const nearLimit = draft.length >= WARN_THRESHOLD;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || trimmed.length > MAX_LENGTH) return;
        onSend(trimmed);
        setDraft("");
      }}
      className="flex flex-col gap-1 border-t border-[var(--border)] bg-[var(--panel)] p-3"
    >
      {nearLimit ? (
        <span
          className={
            "self-end text-[11px] " +
            (draft.length > MAX_LENGTH ? "text-[var(--rose)]" : "text-[var(--text-muted)]")
          }
        >
          {draft.length}/{MAX_LENGTH}
        </span>
      ) : null}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={tCommon("messageAriaLabel")}
          placeholder={t("placeholder")}
          disabled={disabled}
          className="flex-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--text)]"
        />
        <button
          type="submit"
          disabled={disabled || !trimmed || trimmed.length > MAX_LENGTH}
          aria-label={tCommon("send")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--turquoise)] text-[#04211f] disabled:opacity-50"
        >
          <SendIcon className="h-4 w-4" />
        </button>
      </div>
    </form>
  );
}
