"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDateShareLink,
  getDateShareLinks,
  revokeDateShareLink,
  type DateShareLinkSummary,
} from "@/lib/queries/date-share";
import { getSafeErrorMessage } from "@/lib/safe-error-message";
import {
  formatJalaliDateTimeDisplay,
  formatGregorianDateTimeDisplay,
  localIsoToJalaliDateTime,
} from "@/lib/jalali";
import { DateTimeField } from "@/components/date-share/date-time-field";
import { CloseIcon, ShareIcon, CopyIcon } from "@/components/icons";

type Step = "create" | "created" | "manage";

const DATE_SHARE_QUERY_KEY = (matchId: string) => ["date-share", matchId];

function linkStatus(link: DateShareLinkSummary): "active" | "expired" | "revoked" {
  if (link.revokedAt) return "revoked";
  if (new Date(link.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function formatDateTime(iso: string): string {
  const parsed = localIsoToJalaliDateTime(iso);
  if (!parsed) return iso;
  return `${formatJalaliDateTimeDisplay(parsed)} — ${formatGregorianDateTimeDisplay(iso)}`;
}

// FR-378..387: create + manage a match's Share My Date links, reusing
// SafetySheet's bottom-sheet interaction shape (docs/requirements.md
// Feature 19).
export function DateShareSheet({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const t = useTranslations("dateShare.sheet");
  const [step, setStep] = useState<Step>("create");
  const [datetime, setDatetime] = useState<string | null>(null);
  const [locationText, setLocationText] = useState("");
  const [createdLink, setCreatedLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const linksQuery = useQuery({
    queryKey: DATE_SHARE_QUERY_KEY(matchId),
    queryFn: () => getDateShareLinks(matchId),
    enabled: step === "manage",
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!datetime) throw new Error("no datetime selected");
      return createDateShareLink(matchId, datetime, locationText.trim());
    },
    onSuccess: (result) => {
      setCreatedLink({
        url: `${window.location.origin}/date/${result.token}`,
        expiresAt: result.expiresAt,
      });
      setStep("created");
      void queryClient.invalidateQueries({ queryKey: DATE_SHARE_QUERY_KEY(matchId) });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => revokeDateShareLink(matchId, linkId),
    onSuccess: () => {
      setConfirmingRevokeId(null);
      void queryClient.invalidateQueries({ queryKey: DATE_SHARE_QUERY_KEY(matchId) });
    },
  });

  // Same real bug/fix as elsewhere (docs/roadmap.md) — with one deliberate,
  // already-tested exception preserved: a real 409 here has two genuinely
  // distinct real reasons (partner unverified vs. partner opted out,
  // FR-156/173/383), and e2e/date-share.spec.ts's own test asserts the
  // real backend text distinguishes them — so 409 alone still shows the
  // backend's raw detail verbatim (no fixed override), while anything else
  // (an actually unexpected failure) gets the same safe generic fallback
  // as every other fixed site. Guarded on `isError` explicitly —
  // getSafeErrorMessage always returns *some* message (by design, so a
  // caller never has to null-check twice), which would otherwise render
  // persistently once `createMutation.error` is ever non-null, even after
  // a later successful retry leaves `error` populated but `isError` false.
  const createError = createMutation.isError
    ? getSafeErrorMessage(createMutation.error, [{ status: 409 }]).detail
    : undefined;

  // FR-397/398: feature-detected Web Share API, falling back to clipboard —
  // always the real full URL, never the bare token.
  async function shareLink(url: string) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
        return;
      } catch {
        // A user-cancelled share sheet is not an error to surface — fall
        // through to nothing further; the link/copy affordance stays visible.
        return;
      }
    }
    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-[var(--bg-deep)]/70 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--panel)] p-5 shadow-elevation-3 sm:rounded-[var(--radius-lg-value)]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-extrabold">{t("title")}</h2>
          <button type="button" aria-label={t("close")} onClick={onClose}>
            <CloseIcon className="h-5 w-5 text-[var(--text-muted)]" />
          </button>
        </div>

        {step !== "created" ? (
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setStep("create")}
              className={
                step === "create"
                  ? "flex-1 rounded-full bg-[var(--turquoise)] px-3 py-2 font-bold text-[#04211f]"
                  : "flex-1 rounded-full border border-[var(--border)] px-3 py-2 text-[var(--text-muted)]"
              }
            >
              {t("newLink")}
            </button>
            <button
              type="button"
              onClick={() => setStep("manage")}
              className={
                step === "manage"
                  ? "flex-1 rounded-full bg-[var(--turquoise)] px-3 py-2 font-bold text-[#04211f]"
                  : "flex-1 rounded-full border border-[var(--border)] px-3 py-2 text-[var(--text-muted)]"
              }
            >
              {t("previousLinks")}
            </button>
          </div>
        ) : null}

        {step === "create" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!datetime || !locationText.trim()) return;
              createMutation.mutate();
            }}
            className="flex flex-col gap-4"
          >
            <DateTimeField value={datetime} onChange={setDatetime} />
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-[var(--text-faint)]">{t("location")}</label>
              <input
                type="text"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value.slice(0, 200))}
                placeholder={t("locationPlaceholder")}
                maxLength={200}
                required
                className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
              />
              {locationText.length >= 180 ? (
                <span className="text-xs text-[var(--text-muted)]">
                  {locationText.length}/200
                </span>
              ) : null}
            </div>
            {createError ? (
              <p role="alert" className="text-sm text-[var(--rose)]">
                {createError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={!datetime || !locationText.trim() || createMutation.isPending}
              className="rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
            >
              {t("createLink")}
            </button>
          </form>
        ) : null}

        {step === "created" && createdLink ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[var(--text-muted)]">
              {t("createdBody")}
            </p>
            <div className="break-all rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--text)]">
              {createdLink.url}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {t("validUntil", { datetime: formatDateTime(createdLink.expiresAt) })}
            </p>
            <button
              type="button"
              onClick={() => void shareLink(createdLink.url)}
              className="flex items-center justify-center gap-2 rounded-full bg-[var(--turquoise)] px-4 py-3 font-extrabold text-[#04211f] shadow-elevation-cta-turquoise"
            >
              <ShareIcon className="h-5 w-5" />
              {t("share")}
            </button>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(createdLink.url);
                setShareCopied(true);
                setTimeout(() => setShareCopied(false), 2000);
              }}
              className="flex items-center justify-center gap-2 rounded-full border border-[var(--border)] px-4 py-3 font-bold text-[var(--text)]"
            >
              <CopyIcon className="h-5 w-5" />
              {shareCopied ? t("linkCopied") : t("copyLink")}
            </button>
            <button
              type="button"
              onClick={() => setStep("manage")}
              className="text-center text-sm text-[var(--text-muted)] underline"
            >
              {t("viewPreviousLinks")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-center text-sm text-[var(--text-muted)] underline"
            >
              {t("close")}
            </button>
          </div>
        ) : null}

        {step === "manage" ? (
          <div className="flex flex-col gap-3">
            {linksQuery.isLoading ? (
              <p className="text-sm text-[var(--text-muted)]">{t("loading")}</p>
            ) : null}
            {linksQuery.data && linksQuery.data.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                {t("noLinksYet")}
              </p>
            ) : null}
            {linksQuery.data?.map((link) => {
              const status = linkStatus(link);
              return (
                <div
                  key={link.id}
                  className="flex flex-col gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--text)]">{link.locationText}</span>
                    <span
                      className={
                        status === "active"
                          ? "text-xs text-[var(--turquoise)]"
                          : "text-xs text-[var(--text-muted)]"
                      }
                    >
                      {status === "active" ? t("statusActive") : status === "expired" ? t("statusExpired") : t("statusRevoked")}
                    </span>
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">
                    {formatDateTime(link.datetime)}
                  </span>
                  {/* §1/FR-387: the raw token is permanently gone once created —
                      this list can never re-show or re-copy the URL. */}
                  <span className="text-xs text-[var(--text-faint)]">
                    {t("reshareHint")}
                  </span>
                  {status === "active" && confirmingRevokeId !== link.id ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingRevokeId(link.id)}
                      className="mt-1 self-start rounded-full border border-[var(--danger)] px-3 py-1 text-xs font-bold text-[var(--danger)]"
                    >
                      {t("revokeLink")}
                    </button>
                  ) : null}
                  {status === "active" && confirmingRevokeId === link.id ? (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-[var(--text-muted)]">{t("areYouSure")}</span>
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(link.id)}
                        disabled={revokeMutation.isPending}
                        className="rounded-full bg-[var(--danger)] px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {t("confirmRevoke")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingRevokeId(null)}
                        className="text-xs text-[var(--text-muted)] underline"
                      >
                        {t("cancel")}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
