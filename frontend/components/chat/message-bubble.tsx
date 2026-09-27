"use client";

import { useTranslations } from "next-intl";
import type { Message } from "@/lib/queries/chat";
import { formatRelativeTime } from "@/lib/relative-time";

// FR-322: reuses Feature 15's conversational-setup.tsx bubble styling
// verbatim (docs/requirements.md:1914 already named this feature as owning
// the real chat infra around that same visual language).
export function MessageBubble({
  message,
  isOwn,
  failed,
  onRetry,
}: {
  message: Message;
  isOwn: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  const t = useTranslations("chat.messageBubble");
  return (
    <div className={"flex flex-col " + (isOwn ? "items-end" : "items-start")}>
      <div
        className={
          isOwn
            ? "max-w-[80%] rounded-2xl rounded-bl-md bg-[var(--turquoise)] px-4 py-2 text-sm font-bold text-[#04211f]"
            : "max-w-[80%] rounded-2xl rounded-br-md bg-[var(--surface)] px-4 py-2 text-sm"
        }
      >
        {message.content}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-[var(--text-muted)]">
        {failed ? (
          <>
            <span className="text-[var(--rose)]">{t("failedToSend")}</span>
            {onRetry ? (
              <button type="button" onClick={onRetry} className="underline">
                {t("retry")}
              </button>
            ) : null}
          </>
        ) : (
          <span>{formatRelativeTime(message.sentAt)}</span>
        )}
      </div>
    </div>
  );
}
