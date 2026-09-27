"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  updatePrivacy,
  type UserSettings,
  type UpdatePrivacyInput,
} from "@/lib/queries/settings";
import { SETTINGS_QUERY_KEY } from "@/lib/queries/settings-query-keys";

// FR-405..408: privacy toggles — each an immediate, optimistic partial
// PATCH, reverted on a real failure (docs/requirements.md Feature 20).
export function PrivacySection({ settings }: { settings: UserSettings }) {
  const t = useTranslations("settings.privacy");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: UpdatePrivacyInput) => updatePrivacy(input),
    onMutate: async (input) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: SETTINGS_QUERY_KEY });
      const previous = queryClient.getQueryData<UserSettings>(SETTINGS_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<UserSettings>(SETTINGS_QUERY_KEY, {
          ...previous,
          ...input,
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(SETTINGS_QUERY_KEY, context.previous);
      }
      setError(t("saveFailed"));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_QUERY_KEY, data);
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-extrabold text-[var(--text-faint)]">{t("heading")}</h2>

      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-bold text-[var(--text)]">{t("preciseLocation")}</span>
          <span className="text-xs text-[var(--text-muted)]">
            {t("preciseLocationDetail")}
          </span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--turquoise)]"
          checked={settings.preciseLocationEnabled}
          onChange={(e) =>
            mutation.mutate({ preciseLocationEnabled: e.target.checked })
          }
          aria-label={t("preciseLocation")}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-[var(--text)]">{t("whoCanMessage")}</span>
        <div className="flex gap-2">
          {(
            [
              { value: "VERIFIED_ONLY", label: t("verifiedOnly") },
              { value: "EVERYONE", label: t("everyone") },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              aria-pressed={settings.messagingPermission === opt.value}
              onClick={() => mutation.mutate({ messagingPermission: opt.value })}
              className={
                "flex-1 rounded-full px-3 py-2 text-xs font-bold " +
                (settings.messagingPermission === opt.value
                  ? "bg-[var(--turquoise)] text-[#04211f]"
                  : "bg-[var(--surface)] text-[var(--text-muted)]")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-bold text-[var(--text)]">
            {t("shareLinkVisibility")}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {t("shareLinkVisibilityDetail")}
          </span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--turquoise)]"
          checked={settings.allowInSafetyShares}
          onChange={(e) => mutation.mutate({ allowInSafetyShares: e.target.checked })}
          aria-label={t("shareLinkVisibility")}
        />
      </label>

      <label className="flex items-center justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-sm font-bold text-[var(--text)]">
            {t("presenceVisibility")}
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            {t("presenceVisibilityDetail")}
          </span>
        </span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--turquoise)]"
          checked={settings.showLastActiveStatus}
          onChange={(e) =>
            mutation.mutate({ showLastActiveStatus: e.target.checked })
          }
          aria-label={t("presenceVisibility")}
        />
      </label>

      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
