"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/auth-store";
import { SwipeDeck, DECK_QUERY_KEY } from "@/components/discovery/swipe-deck";
import { AiPromptSearch } from "@/components/discovery/ai-search";
import { FiltersPanel } from "@/components/discovery/filters-panel";
import { BoostBanner } from "@/components/discovery/boost-banner";
import { MatchConfirmation } from "@/components/discovery/match-confirmation";
import { ChatIcon, SlidersIcon } from "@/components/icons";
import { BrandMark } from "@/components/brand-mark";
import { LandingPage } from "@/components/landing/landing-page";

type Mode = "deck" | "ai-search";

// FR-256/257: "/" is the discovery screen once the profile is complete
// (Feature 15's completeness gate, useAuthStore-driven) — an incomplete
// profile is redirected to "/profile" instead of seeing discovery at all.
// FR-308: the profile link that used to live in this header (FR-258) is
// superseded by Feature 17's persistent tab bar (app/(tabs)/layout.tsx).
export default function DiscoveryPage() {
  const t = useTranslations("discovery.page");
  const tFilters = useTranslations("discovery.filtersPanel");
  const tTabBar = useTranslations("layout.tabBar");
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("deck");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [deckResetSignal, setDeckResetSignal] = useState(0);
  const [matchedId, setMatchedId] = useState<string | null>(null);

  useEffect(() => {
    if (user && !user.profileCompleted) {
      router.replace("/profile");
    }
  }, [user, router]);

  // Feature 28: the real public landing page for a genuinely logged-out
  // visitor — only once AuthRehydrator has actually settled on
  // "unauthenticated" (not "unknown"), so a will-be-authenticated visitor
  // never sees a flash of marketing copy before their session resolves.
  if (status === "unauthenticated") {
    return <LandingPage />;
  }

  if (!user || !user.profileCompleted) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <BrandMark size={36} />
        <button
          type="button"
          aria-label={tFilters("title")}
          onClick={() => setFiltersOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--panel)] text-[var(--text-muted)]"
        >
          <SlidersIcon className="h-4 w-4" />
        </button>
      </header>

      <BoostBanner />

      <div className="flex gap-2 rounded-full bg-[var(--panel)] p-1">
        <button
          type="button"
          onClick={() => setMode("deck")}
          className={
            "flex-1 rounded-full py-2 text-xs font-extrabold " +
            (mode === "deck" ? "bg-[var(--turquoise)] text-[#04211f]" : "text-[var(--text-muted)]")
          }
        >
          {tTabBar("discover")}
        </button>
        <button
          type="button"
          onClick={() => setMode("ai-search")}
          className={
            "flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-extrabold " +
            (mode === "ai-search"
              ? "bg-[var(--turquoise)] text-[#04211f]"
              : "text-[var(--text-muted)]")
          }
        >
          <ChatIcon className="h-3.5 w-3.5" />
          {t("aiSearchTab")}
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        {mode === "deck" ? (
          <SwipeDeck key={deckResetSignal} onMatched={setMatchedId} />
        ) : (
          <AiPromptSearch onFallbackToDeck={() => setMode("deck")} />
        )}
      </div>

      {filtersOpen ? (
        <FiltersPanel
          onClose={() => setFiltersOpen(false)}
          onSaved={() => {
            void queryClient.resetQueries({ queryKey: DECK_QUERY_KEY });
            setDeckResetSignal((n) => n + 1);
          }}
        />
      ) : null}

      {matchedId ? <MatchConfirmation onClose={() => setMatchedId(null)} /> : null}
    </main>
  );
}
