# Design System

Planned since `product.md` §18's original doc-tree sketch ("`design-system.md` ← tokens from the prototype"), built now, before Feature 14's first line of code, per explicit direction: the goal is a visual identity no other app has, not a shadcn/ui default with Hamava's colors swapped in. Six governing principles were given directly and are preserved as this document's spine (§1–§6); everything else here exists to make those principles concrete and implementable, not just aspirational.

**Source of truth for every token below:** `hamava-prototype_2.html` (the latest/largest of three files found in the user's Downloads folder — see `docs/requirements.md` Feature 14, Open Items #1). Values are copied verbatim from its `:root` CSS custom properties, not approximated.

**How to use this document:** every new UI element built in Features 14–20 is checked against §6 (coherence) before it's considered done. This document is a real constraint on implementation, the same way `requirements.md`'s FRs are — not a mood board to glance at once.

**Live preview:** a working HTML preview of every concrete asset in this document (palette, type, icons, photo frame, the match-moment animation) was built and visually checked before writing this spec down — not designed blind. Two icons (chat, location) failed their first visual check (unrecognizable silhouettes) and were redesigned; see §4.3 for the corrected versions actually in use here.

---

## 1. Color — palette + signature gradient

### 1.1 Base palette (unchanged from the prototype, verbatim)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#11132a` | Page background |
| `--bg-deep` | `#0b0c1e` | Deepest layer — status bar area, overlay bases, brand-mark core |
| `--panel` | `#1a1d3f` | Cards, inputs, primary surface |
| `--surface` | `#222650` | Nested surface (icon chips, tag backgrounds) |
| `--surface-2` | `#2a2f5f` | Secondary nested surface |
| `--turquoise` | `#2fbeb5` | Primary action color, brand identity |
| `--turquoise-dim` | `rgba(47,190,181,.16)` | Turquoise-tinted backgrounds |
| `--gold` | `#e3b155` | Premium/highlight accent (boost, premium tier, warnings-as-information) |
| `--gold-dim` | `rgba(227,177,85,.18)` | Gold-tinted backgrounds |
| `--rose` | `#e88ca0` | Warmth accent (super like, safety-adjacent warmth, never for errors) |
| `--text` | `#f3efe3` | Primary text |
| `--text-muted` | `#a6a8c6` | Secondary text |
| `--text-faint` | `#6c6f96` | Tertiary text — **contrast-check every use**, see §7 |
| `--border` | `rgba(255,255,255,.09)` | Hairline borders |
| radii | `28px` / `18px` / `12px` (lg/md/sm) | Card / control / chip rounding |

`--rose` is warmth, not danger — this palette has no dedicated error/danger color yet (Open Items). Destructive actions (Feature 20's delete-account, block/report confirmations) use `--rose` for now per the prototype's own precedent (`.settings-row.danger` uses rose), flagged for reconsideration once Feature 20 is actually designed, since overloading "warmth" and "destructive" onto the same hue is a real tension worth a second look then, not silently accepted forever.

### 1.2 The signature gradient

The prototype already reaches for a specific conic gradient in exactly two places without naming it: the brand mark (`from 45deg`) and the large profile avatar (`from 120deg`). This is formalized as **one canonical, named asset** — not two ad hoc variants — because a signature element that appears in a different form each time isn't signature, it's decoration.

```css
--signature-gradient: conic-gradient(from 45deg, var(--turquoise), var(--gold), var(--rose), var(--turquoise));
```

**Reserved for moments, not decoration.** Verified visually: the gradient reads as vivid and distinctive precisely because it's rare. Its allowed surfaces are an explicit, closed list:

- The brand mark itself (already established).
- The verified-photo frame ring (§4.4 — new in this document).
- The liveness-verification-complete confirmation (Feature 14).
- The match-moment animation (§5 — the signature gradient's biggest single use).
- A future gold-tier/premium badge, if Feature 20 needs one (not built yet — flagged, not assumed).

**Never used for:** hover states, generic CTAs, loading indicators, or any surface a user sees routinely. The moment this gradient shows up on a "like" button or a settings toggle, it stops meaning anything — that is the one rule every later feature must not break.

A linear variant (`linear-gradient(135deg, var(--turquoise), var(--gold), var(--rose))`) may be used for large text (background-clip: text doesn't render evenly with a conic gradient at arbitrary text widths) — confirmed visually in the preview's headline treatment; same three stops, same closed-list usage rule.

### 1.3 Elevation — glow, not drop-shadow

Added for Feature 23, after this document already shipped without one — a real, confirmed-by-reading-the-whole-document gap, not previously named in §8 either — built the same way as every other asset in this document: a real HTML preview, rendered and visually checked, values adjusted from what was first tried, not written blind (see this section's own history — the first resting-card value was too close to indistinguishable from flat and was strengthened after actually looking at it).

**Revised twice already, each time against real evidence, not on request alone.**
- **v2**: the user supplied a real Lovable-generated mockup showing a genuinely naked-eye-visible turquoise card glow and saturated per-action-button glows — v1's values, checked directly against it, were real but too faint to read as the same *kind* of effect at a glance. Rebuilt the same way as v1 (a real HTML preview, rendered, a rough recreation of the reference's own card+button layout placed directly beside the new tokens for a real side-by-side comparison, not a guess).
- **v3**: the user then confirmed, on a real running screen (not a screenshot), that v2 — despite being genuinely defined, genuinely wired into the compiled CSS, and roughly 2–3x v1's opacity — still wasn't clearly visible. Verified this precisely, per the user's own three-part request, before touching a single value: (1) `grep`'d `shadow-elevation` across both source `globals.css` and the *actual compiled* `.next` CSS output — confirmed the utility class is real and present in both, not a typo'd/undefined class silently doing nothing; (2) read the exact served value directly out of the compiled CSS chunk and confirmed it matched source exactly (not a stale build); (3) concluded correctly that this was case "defined, correctly wired, but genuinely too gentle at these opacities" — box-shadow blur naturally spreads a fixed amount of color over a large area, so v2's 22%/10%-opacity two-layer bloom was real but visually thin once actually spread across 28–60px of blur on a real display. Rebuilt once more, same real-preview method, deliberately more aggressive this time: a real, crisp, semi-opaque **colored ring** (not a soft white edge) as the primary always-visible signal, with glow-layer opacity roughly doubled again from v2.

**Why a conventional shadow system doesn't work here:** every elevation system built for a light UI (Material Design's own included) works because a dark, semi-transparent shadow reads clearly against a light background. This app's entire surface stack (`--bg` `#11132a` down to `--bg-deep` `#0b0c1e`) is already near-black — a conventional `box-shadow: 0 4px 12px rgba(0,0,0,.3)` sits almost invisibly against it. Elevation here has to come from **light added, not shadow subtracted**: a real, visible, brand-colored glow (a two-layer bloom — a tighter, highly-saturated inner glow plus a wider, softer outer one — anchored by a real, crisp colored ring, not a faint white hairline) plus a brighter-than-`--border` edge — the same physical logic as a screen glowing in a dark room rather than an object casting a shadow in daylight. A small amount of genuine dark shadow is kept in each token (it does real work at high blur radii, separating the glow's own edge from the page behind it) but is never the primary signal on its own.

Four real levels, each a single `box-shadow` custom property (stacked layers: colored ring, dark diffusion, inner glow, outer glow):

```css
--elevation-1: 0 0 0 1.5px rgba(47,190,181,.45), 0 4px 16px rgba(0,0,0,.4), 0 0 24px rgba(47,190,181,.55), 0 0 50px rgba(47,190,181,.30);
--elevation-2: 0 0 0 2px rgba(47,190,181,.8), 0 4px 18px rgba(0,0,0,.35), 0 0 30px rgba(47,190,181,.75), 0 0 60px rgba(47,190,181,.40);
--elevation-3: 0 0 0 1.5px rgba(227,177,85,.45), 0 16px 50px rgba(0,0,0,.5), 0 0 45px rgba(227,177,85,.6), 0 0 90px rgba(227,177,85,.32);

--elevation-cta-turquoise: 0 0 0 1.5px rgba(47,190,181,.85), 0 6px 20px rgba(47,190,181,.85), 0 0 40px rgba(47,190,181,.6);
--elevation-cta-rose:      0 0 0 1.5px rgba(232,140,160,.85), 0 6px 20px rgba(232,140,160,.85), 0 0 40px rgba(232,140,160,.6);
--elevation-cta-gold:      0 0 0 1.5px rgba(227,177,85,.85), 0 6px 20px rgba(227,177,85,.85), 0 0 40px rgba(227,177,85,.6);
```

| Level | Token | Use | Real edge/glow |
|---|---|---|---|
| 0 | (none — `--border` alone, unchanged) | Inline chips, list rows, anything already at page level | A plain 1px hairline, no lift — the existing, correct baseline for elements that shouldn't read as a distinct object |
| 1 | `--elevation-1` | Resting cards (match-list row, settings row, a static panel) | A real, crisp, colored ring even at rest (v3 — v1/v2's own versions of this level were both confirmed too faint on a real screen) plus a genuinely saturated bloom and dark diffusion for real separation from the page |
| 2 | `--elevation-2` | The app's own hero/focal card (the swipe deck's `CandidateCard`, the direct real-world match for the reference image), active/hover/focused cards, a selected chip | The strongest ambient-card glow of the set — a highly-saturated turquoise ring plus a real two-layer bloom, deliberately matched to the reference's own always-on card treatment, not just a hover-only accent |
| 3 | `--elevation-3` | Modals, bottom sheets, the filters panel, any overlay floating above a dimmed backdrop | The strongest dark diffusion of the four (real separation from the backdrop is the point here, not brand color) plus a real, unmistakable gold bloom and ring — warmth without competing with whatever content the sheet itself contains |
| CTA | `--elevation-cta-turquoise` / `-rose` / `-gold` | The one primary action per screen (like/save/search buttons → turquoise; super-like → rose, matching its own existing rose fill; boost activation → gold, matching its own existing gold accent) | The most saturated glow of the set, matched to the button's own fill color, real and unmistakable at a glance (the reference image's own action-row buttons were the clearest single proof v1/v2 were both under-scaled) — never a generic dark shadow under a colored button, which would visually fight the fill instead of extending it |

**Governance — folded into §6's existing five-point checklist, not a separate rule:** a new elevated surface is correct only if it uses one of the four levels above (never a hand-tuned one-off `box-shadow`), and the CTA glow's color always matches the button's own fill (never a turquoise glow under a rose button, or vice versa) — the same "restraint, not more flourishes" principle §6 already states for color/type/icons extends here unchanged. Restraint still means "use the right token for the surface's real importance," not "keep every glow faint" — a hero card and a settings row are not the same level of visual importance, and now don't render as though they were.

---

## 2. Typography — Vazirmatn with real hierarchy

Vazirmatn stays the only typeface (unchanged from the prototype), loaded at weights 400/500/600/700/800/900. What changes is deliberate, disciplined use of the extremes of that weight range plus negative tracking on the heaviest sizes — verified visually: at 900-weight with `-0.02em` tracking, "هم‌آوا" reads distinctly more premium than the prototype's own already-bold-but-untracked hero heading.

| Role | Weight | Size | Letter-spacing | Where |
|---|---|---|---|---|
| Display | 900 | `clamp(32px, 6vw, 48px)` | `-0.02em` | App name, the match-moment's "هم‌آوا شدید!" text |
| H1 | 800 | `clamp(22px, 3vw, 28px)` | `-0.01em` | Page/screen titles ("تایید هویت زنده") |
| H2 | 700 | 17–18px | normal | Section headers within a screen |
| Body | 500 | 14–15px | normal | Primary readable text |
| Caption | 600–700 | 11–12.5px | normal | Labels, chips, meta text — matches the prototype's existing convention exactly |

**Rule, not suggestion:** Display and H1 weights (800/900) are reserved for the app identity and screen-level titles — never body copy, never buttons, never chips, no matter how much emphasis a later feature's designer wants. A button that wants emphasis gets color and size, not a 900-weight label; reserving the heavy end of the range is what keeps it feeling premium instead of just "everything is bold."

---

## 3. Icon system

### 3.1 Why not Lucide/Heroicons directly

Reading the prototype's own icon usage directly (all nine tab icons, every inline SVG in the file) confirms the concern that prompted this: every icon in the source file is a standard outline icon at stroke-width values ranging **inconsistently from 1.8 to 2.6** across different icons — recognizably generic (Feather/Heroicons-family silhouettes: a rounded heart, a plain speech bubble, a plain gear). Nothing about them reads as Hamava specifically; they'd be at home in any app. That inconsistency itself (not just the genericness) is worth naming — a real icon system needs one disciplined construction rule, which the source file never actually had.

**Build-time scope note:** `shadcn/ui`'s own generated component internals (a `Dialog`'s close glyph, a `Select`'s chevron, a `Checkbox`'s check mark) keep `lucide-react` as their icon source — those are incidental UI chrome, not brand-facing product icons, and hand-replacing every shadcn primitive's internal glyph is not a good use of effort. The rule above is about every icon a user actually associates with Hamava (like, chat, safety, location, call, verified) — those are always custom, always built to §3.2's rules, never imported from a library.

### 3.2 Construction rules

- **24×24 viewBox**, `1.5px` stroke — thinner than every value used in the prototype (1.8–2.6), chosen deliberately for a more refined, less "sketchy" line than any of its own icons individually had.
- `stroke-linecap="round"`, `stroke-linejoin="round"` — soft terminals and joins, never a sharp miter.
- **Angular vocabulary drawn from the girih tile itself, not a 90°-dominant grid.** The background pattern's hexagon tile (`polygon points="60,10 88,35 88,85 60,110 32,85 32,35"`) is built from 60°/120° turns around a hexagonal frame, not right angles. Icons deliberately favor that same angle set at corners and cut-facets wherever a real design choice exists (a shield's faceted top, a bubble's angled corners, a pin's faceted head) — this, not any single motif, is the actual thing that ties every icon back to the same visual language as the ambient background pattern, and it's exactly the dimension a generic rectilinear icon library (built around 90° grids) cannot replicate by re-coloring.
- **Two states, not one:** outline (`fill:none, stroke:currentColor`) for default/inactive, solid (`fill:currentColor, stroke:none`) for active/selected — mirrors the prototype's own existing like/superlike convention (already solid-fill in its "liked" state), extended into a rule applied consistently everywhere instead of being one icon's special case.

### 3.3 Reference set (visually verified; two redesigned after failing their first check)

Five of seven first-draft icons read correctly on the first visual pass (heart outline, heart filled, checkmark/verified, shield/safety, phone/call). Two did not — the first "location" attempt read as an unrelated badge-with-star, and the first "chat" attempt read as a 3D cube, not a speech bubble — both failures purely of silhouette, not of the stroke-width/corner rules. Both were redesigned and are the versions below; treat this section as v1 reference assets to carry into Feature 14's actual component build, with a further visual QA pass in a real browser at real render sizes (16–32px, not just the 32px preview card) before being treated as final — a preview screenshot at one size is real evidence, not a substitute for checking the actual usage sizes.

```html
<!-- like (outline) -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 20.2c-3.6-2.6-8.6-6.4-8.6-11A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 8.6 2.8c0 4.6-5 8.4-8.6 11z"/>
</svg>

<!-- like (active/filled) -->
<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
  <path d="M12 20.2c-3.6-2.6-8.6-6.4-8.6-11A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 8.6 2.8c0 4.6-5 8.4-8.6 11z"/>
</svg>

<!-- verified / check -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 12l5.2 5.5L20 6"/>
</svg>

<!-- safety / shield -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3.6l7.2 4.2v8.4L12 20.4l-7.2-4.2V7.8z"/>
  <path d="M9 11.2l2.2 2.2 3.8-4"/>
</svg>

<!-- call -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 5.5h4l1.6 4-2.2 1.4a10 10 0 0 0 4.7 4.7l1.4-2.2 4 1.6v4a1.6 1.6 0 0 1-1.7 1.6A14.6 14.6 0 0 1 3.9 6.7 1.6 1.6 0 0 1 5.4 5z"/>
</svg>

<!-- location (redesigned — v1 read as a badge, not a pin) -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3 16.5 6.2v4.8L12 20.5 7.5 11V6.2Z"/>
  <circle cx="12" cy="8.4" r="1.7"/>
</svg>

<!-- chat (redesigned — v1 read as a cube, not a bubble) -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M6 5 18 5 20 7.2V14 L18 16.2H10L6.5 19.4V16.2H6L4 14V7.2Z"/>
  <path d="M8.2 9.6h7.6M8.2 12.6h4.8"/>
</svg>
```

The remaining icons Features 15–20 will need (filters/sliders, gear/settings, discovery/swipe, search/AI, person/profile, help/question, camera, arrow/chevron, close/X, mic, video, etc.) are built from these same three rules at build time, each getting its own quick visual check at real usage size before being treated as done — this document fixes the *system*, not a closed, complete icon library.

---

## 4. Photography & illustration

### 4.1 Principle

Hamava's photos are real, user-uploaded people, not stock photography chosen to look good — the design's job is to frame and protect them, never to compete with them for attention (no busy patterns *over* a photo, no heavy color casts).

### 4.2 The verified-photo frame

Visually confirmed in the preview: a slim signature-gradient ring, inset from the card edge (not flush with it, so it reads as a frame around the photo rather than a colored card border), is a genuinely stronger and more distinctive "this person is verified" signal at a glance — including at thumbnail size in a deck — than the prototype's existing small pill badge alone. The badge is kept, not replaced, as the explicit, textual, up-close confirmation; the ring is the new glanceable signal.

```css
.verified-frame {
  position: relative;
  border-radius: var(--radius-lg); /* 28px, or the card's own radius */
  padding: 3px;
  background: var(--signature-gradient);
}
.verified-frame > .photo {
  border-radius: calc(var(--radius-lg) - 3px);
  /* the actual <img>, inset by exactly the ring's own width */
}
```

An **unverified** photo gets no ring at all (plain `--border` hairline, matching every other card in the system) — the ring's entire meaning depends on it being absent by default, not present-but-dim.

### 4.3 Legibility overlay

For any photo with text over it (name, age, city — Feature 16's swipe deck), a bottom gradient overlay, not a text-shadow-only approach (the prototype currently relies on `text-shadow` alone on `.p-photo h3`, which is a weaker, less consistent legibility guarantee across arbitrary photo content):

```css
background: linear-gradient(180deg, transparent 40%, rgba(11,12,30,.9) 100%);
```

Applied as an absolutely-positioned layer between the photo and the text, not a filter on the photo itself — the photo underneath stays untouched and true to what the user uploaded.

### 4.4 Abstract illustrations (empty states, onboarding)

Where no real user photo exists (empty deck, empty matches, empty chat, onboarding placeholders), illustrations are built from the same girih hexagon/rhombus primitives already established as the ambient background pattern — faint outlined polygons at varying scale, rotation, and opacity, composed into a simple, legible abstract scene, using only palette colors at reduced opacity. Never literal clip-art (generic silhouette-of-two-people, generic heart-with-sparkles) and never a stock photo — both would immediately look like they came from somewhere else. A concrete example (empty match list): three faint hexagon outlines of decreasing size, loosely nested, one corner accented in `--turquoise` at low opacity — evoking "waiting to connect" abstractly rather than illustrating it literally. Each of Features 15–20's actual empty states designs its own specific composition from this primitive vocabulary at build time; this document fixes the *material* (girih polygons, palette-only color, no literal iconography), not every specific scene.

---

## 5. The signature moment — match animation

This is the one interaction explicitly designed to be recognizable and rememberable on its own, reserved exclusively for a real mutual match — never reused for a regular like, a super like, or any lesser confirmation (that restraint is what keeps it meaningful; see §6).

**Choreography (verified via the live preview, timings tuned by eye against the actual animation, not chosen a priori):**

1. **0.0s–1.1s** — the two participants' verified-photo-frame circles (§4.2's ring treatment, circular crop for this moment specifically) slide in from opposite edges with a slight counter-rotation (−8°/+8° easing to 0°), converging toward center. Eased with `cubic-bezier(.2,.8,.2,1)` — the same curve the prototype already uses for its own card-swipe transitions (`.p-card`), reused deliberately rather than introducing a fourth easing curve into the system.
2. **0.9s–1.8s** — at the moment the two frames meet, a girih hexagon motif (the same two-nested-hexagon construction as the background pattern, §3.2) bursts outward from the meeting point, stroked in the signature gradient, scaling from 0 to full size while fading out — the brand's own ambient texture made momentarily explicit and large, rather than an unrelated firework/confetti effect a generic app would reach for.
3. **1.3s–1.9s** — "هم‌آوا شدید!" ("you're in harmony" — a deliberate wordplay on the app's own name) fades and rises into place, set in the Display type role (§2: 900 weight, `-0.02em` tracking, signature gradient as a text fill) — the one place in the entire system Display type and the signature gradient appear together, reinforcing that this is the single highest-emphasis moment the product has.

Total duration ≈ 2s, matching the prototype's own general animation pacing (its screen-transition fade is 0.45s; a moment this significant is deliberately several multiples longer, not the same length as a routine transition).

```css
/* Load-bearing values only — full markup/JS belongs in Feature 17's actual build */
.match-photo.a { animation: slideInA 1.1s cubic-bezier(.2,.8,.2,1) forwards; }
.match-photo.b { animation: slideInB 1.1s cubic-bezier(.2,.8,.2,1) forwards; }
.burst          { animation: burst 0.9s ease-out 0.9s forwards; }
.match-text     { animation: textIn 0.6s ease-out 1.3s forwards; }
```

**Where this belongs:** Feature 17 (match/chat), not Feature 14 — recorded here now because the choreography and its reasoning are a design decision worth locking in ahead of that feature's own `requirements.md`, exactly like a color token. Feature 17's own spec will reference this section rather than re-litigating it.

---

## 6. Coherence over variety — the actual governance rule

Stated directly, because it's the one principle every other section exists to serve: **a new icon, color, gradient, or animation is not approved for use in Hamava's frontend until it passes every item below.** This is a checklist to apply at review time, not a mood statement.

1. **Angle vocabulary** — does it favor the girih hexagon's 60°/120° construction over an arbitrary 90°-grid default, wherever a real choice exists?
2. **Palette discipline** — does it use only tokens from §1.1, plus the signature gradient *only* if the moment genuinely qualifies per §1.2's closed list?
3. **Weight discipline** — if it's type, does it respect §2's reserved-weight rule (900/800 stays reserved for identity/titles)?
4. **Elevation discipline** — if it's a card, sheet, modal, or primary CTA, does it use one of §1.3's four defined levels (never a hand-tuned one-off `box-shadow`, never a plain dark drop-shadow that will read as invisible against this palette)?
5. **Restraint** — could this element be mistaken for a generic library default (Lucide, Heroicons, a stock Tailwind UI kit, Material Design's own light-mode shadow system) by someone who has *not* seen this document? If yes, it isn't done yet.
6. **One real visual check** — has it actually been rendered and looked at (a real browser, a real screenshot, a real reviewer) at its real usage size, the way §3.3's two failed icons and §1.3's first, too-subtle elevation-1 value were caught and fixed — not just asserted correct from its source code?

A professional look here comes from every pixel being deliberate and every element passing this same six-point check — not from adding more visual flourishes. When in doubt, an element that's slightly plainer but fully consistent with §1–§5 is the correct choice over one that's more striking but breaks the system.

---

## 7. Accessibility notes (feeds Feature 14's WCAG 2.1 AA requirement)

- `--text-faint` (`#6c6f96`) genuinely fails AA — **measured, not assumed** (real WCAG relative-luminance contrast formula, Feature 14 FR-221): **3.78:1 on `--bg`, 3.37:1 on `--panel`**, both below the 4.5:1 normal-text threshold (they do clear 3.0:1, so large text — ≥24px regular or ≥18.66px bold — is fine). `--text-muted` (`#a6a8c6`) is the safe token for real body/caption text instead, measured at **7.86:1 on `--bg`** — comfortably passing. A real violation of this was caught and fixed during Feature 14's own build (`frontend/app/page.tsx` was using `--text-faint` for a small, active caption) — `--text-faint` is correctly used in exactly one place in that feature, a genuinely `disabled` button's text, which WCAG 1.4.3 exempts from the contrast requirement entirely. Reference points, also measured for real: `--text` on `--bg` = 15.88:1, `--turquoise` on `--bg` = 7.96:1 — both comfortably pass everywhere they're used.
- The signature gradient must never carry text contrast responsibility on its own for body copy — its one text usage (§5's match-moment headline) is large Display-weight type, exactly the size class where WCAG's large-text contrast allowance actually applies; it is not approved for smaller text.
- Focus rings: a visible `--turquoise` outline, never suppressed for aesthetics — stated once here because it's a real, easy thing for a "premium, minimal" visual language to accidentally sacrifice, and this system does not permit that trade.

---

## 8. Open items

1. **No dedicated error/danger color exists in this palette.** `--rose` currently serves both "warmth" (super like) and "destructive" (§1.1) by the prototype's own precedent — a real tension worth resolving explicitly once Feature 20 (settings, delete-account) is actually designed, not decided silently here.
2. **The icon reference set (§3.3) covers 7 of the ~15+ icons Features 15–20 will eventually need.** The remaining icons are built from the same three construction rules at build time, each getting its own real visual check — this document fixes the system, not a finished library.
3. **The match-moment animation (§5) has not yet been built as real, testable frontend code** — only as a standalone HTML/CSS preview used to verify the choreography reads correctly. Feature 17 owns the real implementation (React/Framer Motion) and its own e2e verification (that it fires only on a real mutual match, per §5's "never for a lesser moment" rule).
4. ~~No elevation/shadow system exists.~~ — ✅ **done**, §1.3, added for Feature 23 (a real, visually-verified glow-based system — this dark palette can't use a conventional drop-shadow approach, see §1.3's own reasoning). Applying it to the actual, already-shipped Features 14–22 screens is that same feature's own remaining work, tracked there, not here.

---

## 9. Spacing scale (added for Feature 26)

Deferred by §1.3's own resolution note and Feature 23 §8 Open Items #1 specifically pending a separate, deliberate request — this is that request, resolved the same evidence-based way as §1.3 (checked against what's real first, not invented from nothing).

**A real survey of the current codebase, not a guess**: a direct grep of every `gap-*`/`p*-*`/`m*-*` Tailwind utility actually in use across `frontend/components` and `frontend/app` shows the real, dominant values already overwhelmingly land on a **4px base unit** — `gap-2`/`py-2` (8px), `px-4`/`gap-4`/`p-4` (16px), `gap-3`/`px-3`/`py-3`/`p-3` (12px), `gap-1` (4px), `gap-6`/`p-6`/`py-6` (24px), `gap-8`/`p-8` (32px) together account for the large majority of every spacing utility in the app today. This isn't a new convention being imposed on the codebase — it's naming and completing a pattern that was already the de facto majority, then closing the real exceptions.

**The real scale — seven steps, 4px base unit:**

| Step | Value | Tailwind utility | Real, existing use |
|---|---|---|---|
| 1 | 4px | `-1` | The tightest internal gap (an icon next to its own label, a chip's own inner padding) |
| 2 | 8px | `-2` | Default gap between closely-related inline items (icon+text in a button, a row of chips) |
| 3 | 12px | `-3` | Default gap between rows in a list, and a compact card's own internal padding (`match-list.tsx`'s real card row, Feature 26) |
| 4 | 16px | `-4` | The app's own default screen-edge padding (`px-4`, already the single most common value in the codebase) and a standard card's internal padding |
| 5 | 24px | `-6` | Gap between distinct sections on the same screen (e.g. a page's own section headings) |
| 6 | 32px | `-8` | Gap between a screen's major regions (e.g. a hero header and its content below) |
| 7 | 48px | `-12` | Reserved for a full-screen state's own top/bottom breathing room (an empty state, an onboarding screen) — used sparingly |

**Real exceptions found by the same survey, to be normalized, not treated as a new, competing pattern**: `gap-1.5`/`py-1.5` (6px) and `py-2.5`/`px-2.5` (10px) are real "half-step" values already in the codebase that don't land on the scale above — each is a genuine Feature 26 finding (§9's own governance rule below), normalized to the nearest real step (6px → step 2 `-2` or step 1 `-1`, chosen per element per the surrounding density; 10px → step 3 `-3`), not left as an undocumented third value between two real steps.

**Explicitly not covered by this scale**: large, one-off page-level layout values that already exist for a specific structural reason unrelated to component-internal spacing — a full-screen centering `py-16` (64px), or the bottom tab bar's own `pb-16`/content's `pb-24` clearance. These are page-shell decisions, not component-spacing inconsistencies, and are not flagged as violations by this scale.

**Governance — folded into §6's existing checklist, same as §1.3's elevation levels**: a new spacing value is correct only if it's one of the seven steps above (or an already-justified page-shell exception) — never a hand-picked in-between value with no real reason.
