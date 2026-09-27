"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// docs/requirements.md Feature 14 FR-220: the one shared loading/error/empty
// pattern every later feature (15-20) reuses instead of reinventing per
// screen. A caller passes a real layout-shaped skeleton via `children` for
// SkeletonBlock, or uses the primitives below to compose one.

export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--surface)]",
        className,
      )}
    />
  );
}

export function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div
      role="alert"
      // Feature 26 (Criterion H): a real, shared static panel per
      // docs/design-system.md §1.3's own Level-1 table row — flat before
      // this, never previously reviewed (no screen in Feature 23's own
      // 22-screen table happened to trigger a real error state).
      className="flex flex-col items-center gap-3 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-6 text-center shadow-elevation-1"
    >
      <p className="font-bold text-[var(--text)]">{title ?? t("errorTitle")}</p>
      {detail ? (
        <p className="text-sm text-[var(--text-muted)]">{detail}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f]"
        >
          {t("retry")}
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  illustration,
}: {
  title: string;
  detail?: string;
  illustration?: React.ReactNode;
}) {
  return (
    <div
      // Feature 26 (Criterion H): the same real, shared gap ErrorState just
      // above closes — every empty state (discovery, matches, who-liked-me,
      // #22/23/26) used this exact component and was flat, never
      // individually audited before this feature's new screens.
      className="flex flex-col items-center gap-4 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-8 text-center shadow-elevation-1"
    >
      {illustration}
      <p className="font-bold text-[var(--text)]">{title}</p>
      {detail ? (
        <p className="text-sm text-[var(--text-muted)]">{detail}</p>
      ) : null}
    </div>
  );
}
