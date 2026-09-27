# Design System v2 — English/LTR/Global Identity (2026-09-22)

> **Status: approved and implemented (Phase 2 foundation), 2026-09-22.** This document's palette, gradient, elevation, and Inter typeface are now live in `app/globals.css`/`app/layout.tsx` — see `docs/i18n-rtl-migration-scope.md` §6 for the implementation report and verification. `docs/design-system.md` (v1) is superseded for these foundational tokens; §5 (icons/illustration) is **not yet implemented** — that's separate, later work, not part of the foundation pass. §7's two open items were resolved by direct product decision (global audience, no Iran-specific considerations — `docs/legal-checklist.md` updated accordingly; brand name "Hamava" kept — see the match-moment copy-replacement options presented separately).

---

## 0. What's actually changing, named directly

v1 (`docs/design-system.md`) is a deliberately Persian-rooted system: Vazirmatn (a Persian/Arabic-first typeface with Latin support, not the reverse), a dark navy palette, and an icon/illustration language explicitly built from the girih hexagon tile — a specific, real piece of Persian/Islamic geometric art tradition, cited as the system's own angle vocabulary and abstract-illustration material (v1 §3.2, §4.4). That entire foundation is Persian-specific, not incidental — it can't be "kept but reskinned," it has to be replaced with a different foundation.

This document does that: a new palette, a new typeface (Latin-first), a new icon/illustration language with no girih ancestry, and a re-examination of every place v1's spacing/elevation math depended on nothing script-specific (most of it — carried forward with only sourcing changes, noted per section).

## 1. Positioning — what "modern global dating app" actually means here

Not one single reference app, and not generic-shadcn-with-new-colors (the same trap v1 was built to avoid, for a different reason). The real, current global dating-app visual landscape splits into two dominant families, and Hamava's new identity picks a side deliberately rather than blending both into mush:

- **Bold/energetic family** (Tinder, Bumble, Hily): saturated, warm gradients (flame reds/oranges, sunny yellow), heavy rounded sans display type, big unmistakable action buttons, dark accents used sparingly against a mostly light/bright base.
- **Quiet/editorial family** (Hinge, Feeld): restrained palettes, a lot of white/cream space, one confident accent color, type-led rather than gradient-led, prompt cards as the actual product surface rather than a photo-first swipe deck.

**Decision for this document: the bold/energetic family**, per the user's explicit brief (swipe cards, vivid gradients, bold rounded type, big clear buttons) — this is also the family v1's own "signature gradient + big glowing CTA" instincts already partially matched, so the emotional register (energetic, warm, confident) carries forward even though every literal asset changes. If review lands closer to the quiet/editorial family instead, that's a real, different document — flag it now rather than half-committing to both.

## 2. Color

### 2.1 The base-mode decision, named explicitly (not silently inherited from v1)

**v1 is dark-mode-first** (`--bg: #11132a`), with a whole elevation system (v1 §1.3) built specifically to solve "glow reads better than shadow on a near-black surface." **v2 proposes light-mode-first**, matching where the bold/energetic global family actually lives today (Tinder, Bumble, and Hily are all light-surface apps; their saturated gradients and dark UI chrome sit on top of white or near-white, not the reverse) — a dark base and a "vivid gradient + big glow" language pull in different directions once the base actually is light, because glow-over-white doesn't read as elevation the way it does over near-black; it just reads as a soft colored shadow, which is a fine, normal thing, not a fight.

This is the single largest structural change in this document — bigger than the palette or the font — and is called out as its own decision, not folded silently into "new colors": **v1's entire §1.3 elevation system (the colored-ring-plus-bloom glow mechanic) does not carry forward as designed; a light-surface equivalent is specified fresh in §4, not adapted line-by-line.**

### 2.2 Base palette

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fffaf7` | Page background — warm off-white, not clinical pure white |
| `--panel` | `#ffffff` | Cards, inputs, primary surface |
| `--surface` | `#fff1ea` | Nested surface (chips, tag backgrounds), warm-tinted |
| `--ink` | `#1a1420` | Primary text — near-black with a warm undertone, not flat `#000` |
| `--ink-muted` | `#6b6070` | Secondary text |
| `--ink-faint` | `#a89aa8` | Tertiary text — **contrast-check every use before shipping, same discipline as v1 §7**; likely fails AA for normal-size text and will need the same "large-text-only or disabled-only" restriction v1 already learned the hard way |
| `--coral` | `#ff5864` | Primary action color, brand identity — the "like/yes" register |
| `--coral-dim` | `rgba(255,88,100,.12)` | Coral-tinted backgrounds |
| `--violet` | `#7c5cff` | Secondary accent — premium/highlight, the "super-like/boost" register |
| `--violet-dim` | `rgba(124,92,255,.12)` | Violet-tinted backgrounds |
| `--amber` | `#ffb648` | Warmth/celebration accent (match moment, streaks) |
| `--danger` | `#d92d20` | **A real, dedicated error/destructive color — v1 never had one (v1 §8 Open Items #1, still open at v1's own last revision).** Closing that gap here rather than inheriting the ambiguity. |
| `--border` | `rgba(26,20,32,.08)` | Hairline borders on a light surface |
| radii | `28px` / `18px` / `12px` (lg/md/sm) | Unchanged shape language from v1 — corner rounding isn't script- or theme-dependent, no reason to redesign a number that already works |

### 2.3 The signature gradient

Replaces v1's girih-adjacent conic gradient (turquoise→gold→rose) with a **coral→amber→violet** linear sweep — the "sunset" register common across the bold/energetic family (Tinder's flame, Bumble's warmth) but built as one specific, named, closed-list asset exactly the way v1 disciplined itself to do, not an undifferentiated rainbow:

```css
--signature-gradient: linear-gradient(135deg, var(--coral), var(--amber), var(--violet));
```

**Same closed-list discipline as v1 §1.2, carried forward as a principle even though every color changed:** reserved for the brand mark, the verified-photo frame ring, the match-moment animation, and a premium/boost badge — never a routine hover state, generic CTA, or loading indicator. This governance rule is script- and palette-independent; there's no reason to weaken it just because the colors are new.

## 3. Typography

**Inter**, Latin-first, variable weight axis — chosen over Poppins specifically because Inter is a true variable font (one file, continuous weight range, better real-world performance per the same Lighthouse-driven discipline v1's own font-loading comment already established for Vazirmatn) and because its slightly more neutral, less geometric letterforms hold up better at small UI sizes (labels, chips) than Poppins' more circular, display-leaning shapes — Poppins remains a reasonable second choice if a real rendered comparison (the same "build it, look at it" discipline every section of v1 used) favors it once actually seen in the app's real layouts, not decided from a font-specimen page alone.

| Role | Weight | Size | Letter-spacing | Where |
|---|---|---|---|---|
| Display | 800 | `clamp(32px, 6vw, 48px)` | `-0.02em` | App name, the match-moment headline |
| H1 | 700 | `clamp(22px, 3vw, 28px)` | `-0.01em` | Page/screen titles |
| H2 | 600 | 17–18px | normal | Section headers |
| Body | 400–500 | 14–15px | normal | Primary readable text |
| Caption | 600 | 11–12.5px | normal | Labels, chips, meta text |

Negative tracking on Display/H1 carries forward from v1 unchanged in principle — this is standard practice for bold Latin display type (tight tracking on large weights is arguably even more established in Latin type design than it was as a Vazirmatn-specific finding), not a Persian-specific technique that needs reinventing. The v1 rule that heavy weights (700/800) are reserved for identity and titles — never body copy, never buttons — carries forward unchanged; it's a hierarchy discipline, not a script-dependent one.

## 4. Elevation (light-mode, replacing v1 §1.3 fresh, not adapting it)

Per §2.1's decision: glow-on-dark doesn't translate to a light surface as the same mechanic. The light-family equivalent most of the bold/energetic reference apps actually use is a **soft, warm-tinted shadow plus a crisp saturated ring on the one primary CTA per screen** — shadow does real work again here, the way it can't on v1's near-black base, so this isn't "the same system with new colors," it's "the same three-level hierarchy, built from the material that actually works for a light surface."

```css
--elevation-1: 0 1px 2px rgba(26,20,32,.04), 0 4px 12px rgba(26,20,32,.06);
--elevation-2: 0 2px 4px rgba(26,20,32,.06), 0 12px 32px rgba(26,20,32,.12);
--elevation-3: 0 8px 16px rgba(26,20,32,.08), 0 24px 60px rgba(26,20,32,.18);

--elevation-cta-coral:  0 0 0 1.5px rgba(255,88,100,.9), 0 8px 24px rgba(255,88,100,.35);
--elevation-cta-violet: 0 0 0 1.5px rgba(124,92,255,.9), 0 8px 24px rgba(124,92,255,.35);
--elevation-cta-amber:  0 0 0 1.5px rgba(255,182,72,.9),  0 8px 24px rgba(255,182,72,.35);
```

Level assignment (resting cards / hero card / modals+sheets / primary CTA) carries forward from v1's own §1.3 table unchanged — that mapping is about visual hierarchy of *screen elements*, not about dark-vs-light material, so there's no reason to re-derive it. **This must go through the same real-preview verification discipline v1 used** (v1 §1.3's own history — two revisions, both driven by looking at a real rendered screen, not by reasoning about opacity values on paper) before being treated as final; the numbers above are a starting proposal, not pre-verified the way this document would otherwise claim as a real asset.

## 5. Iconography & illustration (replacing v1 §3, §4.4 — no girih ancestry)

v1's entire icon-construction rule (v1 §3.2) was "draw from the girih tile's 60°/120° angle vocabulary, not a 90°-grid default" — this is the one piece of v1 with zero possible LTR/English-market translation, since it isn't a layout-direction issue, it's a specific cultural-art-motif choice. It has to be replaced with a different real rule, not just "use whatever."

**Proposed replacement rule**: a fully-rounded, friendly stroke system — 24×24 viewBox, 1.75–2px stroke (slightly heavier than v1's refined 1.5px, matching the bolder, friendlier register of the bold/energetic family rather than v1's more refined/premium-quiet register), `stroke-linecap="round"`/`stroke-linejoin="round"` unchanged from v1, but the angle discipline becomes "prefer continuous curves and 45°/90° facets over sharp, angular cuts" — the opposite instinct from v1's hexagon-derived faceting, matching how Tinder/Bumble/Hily's own icon sets actually read (soft, round, friendly, not geometric/faceted). Two-state outline/filled convention (v1 §3.2's last rule) carries forward unchanged — that's a genuinely script- and culture-independent interaction pattern, not something that needs replacing.

Illustration material (v1 §4.4's girih-polygon empty states) is replaced with **soft blob/organic shapes** in the signature-gradient palette at reduced opacity — the equivalent "abstract, on-brand, never literal clip-art" role v1's polygons played, built from a different, non-Persian-specific primitive.

Real construction and a real rendered check (matching v1 §3.3's own "two icons failed their first visual pass and were redesigned" discipline) is Phase 2/implementation work, not this document's job — this section fixes the *system*, exactly as v1 did for its own icon set.

## 6. Spacing scale — carries forward unchanged

v1 §9's 4px-base, seven-step spacing scale (`docs/design-system.md` §9) is a pure layout-density system with zero script or RTL/LTR dependency — a gap between two chips is the same number of pixels whether the page reads left-to-right or right-to-left. **No change proposed here.** The one real thing that does change with the LTR flip is which *side* of an element carries a given spacing value (a "gap before the icon" becomes "gap after the icon" when the reading direction flips) — that's a layout/implementation concern for §8 below, not a token-system concern for this document.

## 7. Open items — decisions needed, not resolved here

1. **Brand name ("Hamava"/"هم‌آوا") — flagged, not decided.** "هم‌آوا" is a real Persian word (roughly "in harmony/unison," a deliberate wordplay already load-bearing in the current match-moment copy — v1 §5's "هم‌آوا شدید!"). For a global, English-first audience, the name stops carrying its intended meaning and becomes an arbitrary sound, similar in kind to how "Bumble," "Hinge," "Feeld," or "Grindr" aren't literal English words either — so an invented-sounding name isn't disqualifying on its own, but the *specific* wordplay this brand was built around (the match-moment text, arguably the product's single most designed-for-meaning moment, v1 §5) stops working the moment the audience can't read the pun. Two real paths, neither chosen here: (a) keep "Hamava" as a now-arbitrary global brand name and retire the wordplay-dependent copy moments; (b) rename entirely. This needs real input this document can't supply (trademark/domain availability, whether any brand equity already exists worth preserving, whether a test audience actually finds "Hamava" appealing without the Persian meaning) — recommend treating it as its own small research task before Phase 2 implementation begins, not a default either way.
2. **Seed test data (`docs/test-users.md`, 20 Persian-named users)** — see `docs/i18n-rtl-migration-scope.md` §5.1 for the concrete decision framing; this document only notes that every new marketing/screenshot asset built from v2 will look inconsistent next to Persian-named fixture data (علی رضایی, تهران, etc.) if seed data isn't addressed in the same phase, even though the seed data itself is a backend/testing concern, not a design-system one.

---

*Awaiting review. Nothing in this document is implemented; `docs/design-system.md` remains the live, shipped system until told otherwise.*
