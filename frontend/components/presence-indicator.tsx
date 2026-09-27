"use client";

import { useTranslations } from "next-intl";
import type { PresenceValue } from "@/lib/queries/discovery";
import { formatRelativeTime } from "@/lib/relative-time";

/**
 * Feature 27 (FR-485..FR-488): the one shared implementation of "what does
 * presence look like," reused by candidate-card.tsx, match-list.tsx, and
 * conversation-view.tsx — a live green dot when online, a relative "Active …
 * ago" string when not (reusing the already-shipped formatRelativeTime(),
 * per explicit user direction — no second formatter), and nothing at all
 * when `presence` is null (privacy-hidden) or `lastOnlineAt` is null (no
 * recorded history yet — never fabricate a claim).
 *
 * A plain function, not a component — useTranslations() (a hook) can't run
 * here, and every caller already has its own translation context. Hardcoded
 * English at the current single-locale scope, same precedent as
 * lib/safe-error-message.ts's DEFAULT_FALLBACK; revisit if a real second
 * language is ever added.
 */
export function formatPresenceLabel(presence: PresenceValue | null): string | null {
  if (!presence) return null;
  if (presence.online) return "Online";
  if (!presence.lastOnlineAt) return null;
  return `Active ${formatRelativeTime(presence.lastOnlineAt)}`;
}

/**
 * A small live-presence dot, positioned by the caller (pass absolute
 * positioning classes via `className`; the parent needs `position: relative`).
 * Renders only when genuinely online — the offline/last-active case is text
 * (formatPresenceLabel), never a second, greyed-out dot variant.
 */
export function PresenceDot({
  presence,
  className = "",
}: {
  presence: PresenceValue | null;
  className?: string;
}) {
  const t = useTranslations("common");
  if (!presence?.online) return null;
  return (
    <span
      role="img"
      aria-label={t("online")}
      className={`block rounded-full bg-[var(--turquoise)] ring-2 ring-[var(--panel)] ${className}`}
    />
  );
}
