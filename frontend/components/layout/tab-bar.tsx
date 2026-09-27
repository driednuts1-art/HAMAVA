"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  HeartIcon,
  HeartFilledIcon,
  LikedByIcon,
  LikedByFilledIcon,
  ChatIcon,
  UserIcon,
  SettingsIcon,
} from "@/components/icons";
import { getConversations } from "@/lib/queries/chat";
import { CONVERSATIONS_QUERY_KEY } from "@/lib/queries/chat-query-keys";
import { getWhoLikedMeCount, WHO_LIKED_ME_COUNT_QUERY_KEY } from "@/lib/queries/discovery";

// FR-308/309/402/462: five real tabs — Settings (Feature 20) and now Who
// Liked Me (Feature 24 §2) both closing earlier forward-references. Still
// within docs/requirements.md Feature 24 §8's own "no more than 5" cap.
// Both badges reuse an existing shared query (Open Items #2 precedent) —
// no separate polling loop per tab.
export function TabBar() {
  const t = useTranslations("layout.tabBar");
  const tSettings = useTranslations("settings.page");
  const pathname = usePathname();

  const conversationsQuery = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: getConversations,
  });
  const unreadCount = (conversationsQuery.data ?? []).reduce(
    (sum, c) => sum + c.unreadCount,
    0,
  );

  const likedCountQuery = useQuery({
    queryKey: WHO_LIKED_ME_COUNT_QUERY_KEY,
    queryFn: getWhoLikedMeCount,
  });

  const tabs = [
    { href: "/", label: t("discover"), icon: pathname === "/" ? HeartFilledIcon : HeartIcon },
    {
      href: "/liked",
      label: t("liked"),
      icon: pathname === "/liked" ? LikedByFilledIcon : LikedByIcon,
      badge: likedCountQuery.data?.count ?? 0,
    },
    { href: "/matches", label: t("matches"), icon: ChatIcon, badge: unreadCount },
    { href: "/profile", label: t("profile"), icon: UserIcon },
    { href: "/settings", label: tSettings("title"), icon: SettingsIcon },
  ] as const;

  return (
    <nav
      aria-label={t("mainNavigation")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--panel)] shadow-elevation-3"
    >
      <div className="mx-auto flex w-full max-w-sm items-center justify-around px-2 py-2">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-label={tab.label}
              aria-current={active ? "page" : undefined}
              className={
                "relative flex flex-1 flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-bold " +
                (active ? "text-[var(--turquoise)]" : "text-[var(--text-muted)]")
              }
            >
              <span className="relative">
                <Icon className="h-5 w-5" />
                {"badge" in tab && tab.badge > 0 ? (
                  <span
                    aria-hidden="true"
                    className="absolute -left-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--rose)] px-1 text-[9px] font-extrabold text-[#2c0d16]"
                  >
                    {tab.badge > 9 ? "9+" : tab.badge}
                  </span>
                ) : null}
              </span>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
