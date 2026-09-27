"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";

// FR-411/412: the first working logout UI trigger this app has ever had —
// `POST /api/auth/logout` (app/api/auth/logout/route.ts) has existed since
// Feature 14 but nothing called it until now.
export function LogoutButton() {
  const t = useTranslations("settings.logout");
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: () => fetch("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      useAuthStore.getState().clearSession();
      router.replace("/login");
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-full border border-[var(--border)] px-4 py-3 text-left font-bold text-[var(--text)] shadow-elevation-1"
      >
        {t("logOut")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-lg-value)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-sm text-[var(--text-muted)]">
        {t("confirmBody")}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex-1 rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f] shadow-elevation-cta-turquoise disabled:opacity-50 disabled:shadow-none"
        >
          {mutation.isPending ? t("loggingOut") : t("confirmLogOut")}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="flex-1 rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold text-[var(--text)]"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
