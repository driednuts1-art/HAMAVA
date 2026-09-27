import { getRequestConfig } from "next-intl/server";

// Phase 2 foundation (docs/i18n-rtl-migration-scope.md): a real, structured
// i18n layer, deliberately without URL-based locale routing (a single fixed
// locale, no `[locale]` route-tree restructuring) — this app is English-only
// today, and per-feature content still lives inline in each component
// (Phase 3, not yet started). This file exists so that plumbing is real and
// testable now, without forcing a premature, invasive routing decision.
const locale = "en";

export default getRequestConfig(async () => ({
  locale,
  messages: (await import(`../messages/${locale}.json`)).default,
}));
