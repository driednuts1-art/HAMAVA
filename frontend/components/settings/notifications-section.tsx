"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  updateNotifications,
  type UserSettings,
  type UpdateNotificationsInput,
} from "@/lib/queries/settings";
import { SETTINGS_QUERY_KEY } from "@/lib/queries/settings-query-keys";

const TOGGLE_KEYS: (keyof UpdateNotificationsInput)[] = [
  "notifyOnNewMatch",
  "notifyOnNewMessage",
  "notifyOnSafetyAlert",
];

// FR-409/410: persisted only — real, visible copy states plainly that
// nothing is actually sent yet (Feature 6 FR-82, unchanged).
export function NotificationsSection({ settings }: { settings: UserSettings }) {
  const t = useTranslations("settings.notifications");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: UpdateNotificationsInput) => updateNotifications(input),
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
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-extrabold text-[var(--text-faint)]">{t("heading")}</h2>
        <p className="text-xs text-[var(--text-muted)]">
          {t("subtitle")}
        </p>
      </div>

      {TOGGLE_KEYS.map((key) => (
        <label key={key} className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold text-[var(--text)]">{t(`toggles.${key}`)}</span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--turquoise)]"
            checked={settings[key]}
            onChange={(e) => mutation.mutate({ [key]: e.target.checked })}
            aria-label={t(`toggles.${key}`)}
          />
        </label>
      ))}

      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
