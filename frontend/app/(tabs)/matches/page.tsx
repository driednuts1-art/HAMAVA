"use client";

import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand-mark";
import { MatchList } from "@/components/matches/match-list";

export default function MatchesPage() {
  const t = useTranslations("layout.tabBar");
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col gap-4 py-6">
      <header className="flex items-center gap-3 px-4">
        <BrandMark size={32} />
        <h1 className="text-xl font-extrabold tracking-[-0.01em]">{t("matches")}</h1>
      </header>
      <MatchList />
    </main>
  );
}
