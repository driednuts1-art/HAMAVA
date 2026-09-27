"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { getPublicDateShare } from "@/lib/queries/date-share";
import { ApiRequestError } from "@/lib/api-error";
import { formatJalaliDateTimeDisplay, formatGregorianDateTimeDisplay, localIsoToJalaliDateTime } from "@/lib/jalali";
import { SkeletonLine, ErrorState } from "@/components/page-states";
import { LocationIcon, UserIcon } from "@/components/icons";

// FR-389..391: the trusted contact's real, unauthenticated view. Renders
// exactly the real backend response (docs/requirements.md Feature 19 §6.3) —
// nothing more.
export function PublicDateView({ token }: { token: string }) {
  const t = useTranslations("dateShare.publicView");
  const query = useQuery({
    queryKey: ["public-date-share", token],
    queryFn: () => getPublicDateShare(token),
    retry: false,
  });

  if (query.isLoading) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <SkeletonLine className="h-32 w-32 self-center rounded-full" />
        <SkeletonLine className="h-5 w-40 self-center" />
        <SkeletonLine className="h-4 w-full" />
        <SkeletonLine className="h-4 w-2/3" />
      </div>
    );
  }

  if (query.isError) {
    const status =
      query.error instanceof ApiRequestError ? query.error.problem.status : undefined;
    // FR-391: a real 429 is a genuinely different, honest state — never
    // merged into FR-390's deliberately uninformative generic message.
    if (status === 429) {
      return (
        <ErrorState
          title={t("tooManyAttemptsTitle")}
          detail={t("tooManyAttemptsDetail")}
        />
      );
    }
    // FR-390: never existed, expired, or revoked — genuinely indistinguishable
    // by design (the real backend's own FR-164), so this is the one and only
    // failure message shown for all three.
    return <ErrorState title={t("linkNoLongerValid")} />;
  }

  const view = query.data;
  if (!view) return null;

  const parsed = localIsoToJalaliDateTime(view.datetime);

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
      <div className="h-28 w-28 overflow-hidden rounded-full bg-[var(--surface)]">
        {view.partnerPhotoUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- freshly-signed S3 URL */
          <img src={view.partnerPhotoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <UserIcon className="h-10 w-10 text-[var(--text-faint)]" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-extrabold text-[var(--text)]">
          {view.partnerDisplayName ?? t("noName")}
        </h1>
        <p className="text-xs text-[var(--turquoise)]">{t("verifiedHamavaUser")}</p>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        {t("sharedThisDate", { name: view.sharerDisplayName ?? t("noName") })}
      </p>
      <div className="flex w-full flex-col gap-3 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-4 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--text)]">
            {parsed
              ? `${formatJalaliDateTimeDisplay(parsed)} — ${formatGregorianDateTimeDisplay(view.datetime)}`
              : view.datetime}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <LocationIcon className="h-5 w-5 shrink-0 text-[var(--text-muted)]" />
          <span className="text-sm text-[var(--text)]">{view.locationText}</span>
        </div>
      </div>
    </div>
  );
}
