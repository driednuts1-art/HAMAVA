// A small, self-contained relative-time formatter for Feature 17's
// conversation list ("just now", "5 minutes ago", ...) — deliberately not
// added to lib/jalali.ts, which is scoped specifically to birth-date
// Gregorian<->Jalali conversion math (see that file's own header comment).
//
// A plain function, not a component — useTranslations() (a hook) can't run
// here. Hardcoded English at the current single-locale scope, same
// precedent as lib/safe-error-message.ts's DEFAULT_FALLBACK; revisit with a
// real pluralization-aware i18n call if a second language is ever added.
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.max(0, (Date.now() - then) / 1000);

  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}
