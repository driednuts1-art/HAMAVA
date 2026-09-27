import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import "./globals.css";
import { cn } from "@/lib/utils";
import { AppProviders } from "@/components/providers/app-providers";

// docs/design-system-v2.md §3: Inter replaces Vazirmatn — a true variable
// font (one file, continuous weight range) rather than a fixed weight set,
// matching the same Lighthouse-driven font-loading discipline the previous
// choice was already held to (FR-222).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Phase 2 foundation (docs/i18n-rtl-migration-scope.md): sourced from the
// real i18n layer, not a hardcoded string — the minimal, real proof that the
// message-loading plumbing works end to end, ahead of Phase 3's full
// per-feature content migration.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: t("appName"),
    description: t("tagline"),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const messages = await getMessages();
  return (
    <html
      lang="en"
      dir="ltr"
      className={cn("h-full", "antialiased", inter.variable, "font-sans")}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <NextIntlClientProvider messages={messages}>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
