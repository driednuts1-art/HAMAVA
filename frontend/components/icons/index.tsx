import type { SVGProps } from "react";

// docs/design-system.md §3 — Hamava's own icon system: 24×24, 1.5px stroke,
// round caps/joins, an angular vocabulary drawn from the girih hexagon tile
// rather than a 90°-grid default. Never import lucide-react (or any icon
// library) for a brand/product-facing icon — only these, or a new one built
// to the same three rules and visually checked at real usage size.

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HeartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20.2c-3.6-2.6-8.6-6.4-8.6-11A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 8.6 2.8c0 4.6-5 8.4-8.6 11z" />
    </svg>
  );
}

export function HeartFilledIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <path d="M12 20.2c-3.6-2.6-8.6-6.4-8.6-11A5.2 5.2 0 0 1 12 6.4a5.2 5.2 0 0 1 8.6 2.8c0 4.6-5 8.4-8.6 11z" />
    </svg>
  );
}

export function VerifiedIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 12l5.2 5.5L20 6" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.6l7.2 4.2v8.4L12 20.4l-7.2-4.2V7.8z" />
      <path d="M9 11.2l2.2 2.2 3.8-4" />
    </svg>
  );
}

export function CallIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5h4l1.6 4-2.2 1.4a10 10 0 0 0 4.7 4.7l1.4-2.2 4 1.6v4a1.6 1.6 0 0 1-1.7 1.6A14.6 14.6 0 0 1 3.9 6.7 1.6 1.6 0 0 1 5.4 5z" />
    </svg>
  );
}

// Feature 18: a video-call entry point (docs/requirements.md FR-349).
// Rounded-rect camera body + an angled (not rectangular) viewfinder flap —
// the flap's non-perpendicular facets are the one real design choice here
// that ties it to the girih-hexagon angle vocabulary (§3.2), same
// reasoning as ShieldIcon's own faceted top.
export function VideoIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
      <path d="M18 10.2 21.5 7.6v8.8L18 13.8Z" />
    </svg>
  );
}

export function LocationIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 16.5 6.2v4.8L12 20.5 7.5 11V6.2Z" />
      <circle cx="12" cy="8.4" r="1.7" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 5 18 5 20 7.2V14 L18 16.2H10L6.5 19.4V16.2H6L4 14V7.2Z" />
      <path d="M8.2 9.6h7.6M8.2 12.6h4.8" />
    </svg>
  );
}

// Feature 15 — added to the same system, same three rules (§3.2).
export function CameraIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13.2" r="3.6" />
    </svg>
  );
}

export function MicIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.6a3 3 0 0 1 3 3v5.4a3 3 0 0 1-6 0V6.6a3 3 0 0 1 3-3z" />
      <path d="M7 11.4a5 5 0 0 0 10 0" />
      <path d="M12 16.4v3.4M9.2 19.8h5.6" />
    </svg>
  );
}

export function SendIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M20 4 4 10.2l6.4 2.4L18.6 6l-6.6 8.4 2.4 6.2Z" />
    </svg>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 4.6 19.4 9 8.4 20 4 20.2 4.2 15.8Z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 7h14M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" />
      <path d="M6.5 7 7.3 19.4a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L17.5 7" />
      <path d="M10 10.8v6M14 10.8v6" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

// Feature 16 — added to the same system, same three rules (§3.2). The bolt
// and user shapes intentionally reuse hamava-prototype_2.html's own paths
// (its `.boost-banner svg` and profile-tab icon) for visual continuity with
// the design reference this whole system is anchored to, adapted to this
// system's 1.5px stroke.
export function StarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.4l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7Z" />
    </svg>
  );
}

export function StarFilledIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <path d="M12 3.4l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6-4.5-4.1 6-.7Z" />
    </svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h13M21 17h-1" />
      <circle cx="15" cy="7" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="7" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="17" cy="17" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13 2.4 3.8 14h6.4l-.9 7.6L18.2 10H11.8Z" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.4 20c1.4-4 4.8-6 7.6-6s6.2 2 7.6 6" />
    </svg>
  );
}

// Feature 17: conversation-header back action (docs/requirements.md
// FR-326) — points right, matching this app's RTL reading direction.
// A universally-recognized "back" glyph is a deliberate, minor exception to
// §3.2's hexagon-angle preference: a 60/120° chevron reads as unfamiliar
// for this one specific, high-frequency navigation affordance, and §3.2
// itself frames the angle rule as applying "wherever a real design choice
// exists," not as a mandate overriding legibility.
export function BackIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 6l6 6-6 6" />
    </svg>
  );
}

// Feature 19: Share My Date's own share/copy affordances (docs/requirements.md
// FR-397/398). Both are, like BackIcon above, deliberate exceptions to §3.2's
// hexagon-angle preference — "share" (an open box + an arrow breaking out the
// top) and "copy" (two overlapping pages) are universally-recognized OS-level
// glyphs for these exact two actions; inventing a hexagon-vocabulary
// alternative would read as unfamiliar for something users already know on sight.
export function ShareIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 12v6.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V12" />
      <path d="M12 15.5V4.5M8.2 8.3 12 4.5l3.8 3.8" />
    </svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="4" width="12" height="12" rx="2" />
      <path d="M8 16v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

// Feature 20: the settings tab (docs/requirements.md FR-402) — a hexagon
// silhouette (§3.2's own girih-hexagon vocabulary, matching ShieldIcon's
// faceted construction) standing in for a gear, rather than a realistic
// circular cog that would break the system's angle rule.
export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 19.8 7.5V16.5L12 21 4.2 16.5V7.5Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Feature 22: the Help Center row (docs/requirements.md FR-308) — a
// question mark, a deliberate exception to §3.2's hexagon-angle preference
// for the same reason as BackIcon/ShareIcon above: universally recognized
// on sight, where a hexagon-vocabulary alternative would read as unfamiliar.
export function HelpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1 .9-1 1.6v.4" />
      <circle cx="12" cy="16.9" r="0.15" fill="currentColor" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

// Feature 22: the Legal (Privacy Policy / Terms) row (docs/requirements.md
// FR-312) — a faceted document shape, matching ShieldIcon's own
// non-rectangular top corner (§3.2's hexagon-angle vocabulary) rather than
// a plain rectangular page.
export function DocumentIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3.6h7.4L19 8.2V19.4a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.6a1 1 0 0 1 1-1Z" />
      <path d="M14.4 3.6V8.2H19" />
      <path d="M8.6 12.4h6.8M8.6 15.6h6.8M8.6 18h4" />
    </svg>
  );
}

// Feature 24 (docs/requirements.md FR-459/FR-462): the "Who Liked Me" tab —
// a real, distinct glyph from HeartIcon/HeartFilledIcon (Discover's own tab),
// since both live in the tab bar at once. A heart ringed by radiating
// girih-hexagon facets (§3.2) reads as "someone's attention is on you,"
// rather than reusing the plain heart the Discover tab already owns.
export function LikedByIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 15.6c-2.4-1.8-5.6-4.2-5.6-7.2A3.4 3.4 0 0 1 12 5.8a3.4 3.4 0 0 1 5.6 2.6c0 3-3.2 5.4-5.6 7.2z" />
      <path d="M4 4.4 5.4 6M20 4.4 18.6 6M3 11h2.2M21 11h-2.2" />
    </svg>
  );
}

export function LikedByFilledIcon(props: IconProps) {
  return (
    <svg {...base} {...props} fill="none">
      <path
        d="M12 15.6c-2.4-1.8-5.6-4.2-5.6-7.2A3.4 3.4 0 0 1 12 5.8a3.4 3.4 0 0 1 5.6 2.6c0 3-3.2 5.4-5.6 7.2z"
        fill="currentColor"
        stroke="none"
      />
      <path d="M4 4.4 5.4 6M20 4.4 18.6 6M3 11h2.2M21 11h-2.2" />
    </svg>
  );
}

// Feature 24 (FR-439, height): a faceted ruler — angled tick marks instead
// of a perpendicular grid, tying it to §3.2's hexagon-angle vocabulary.
export function RulerIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 15.5 15.5 5l3.5 3.5L8.5 19Z" />
      <path d="M9.4 15.6 11 14M12 12.9l1.6-1.6M15.1 9.8l1.6-1.6" />
    </svg>
  );
}

// Feature 24 (FR-440, education): a faceted graduation cap, matching
// ShieldIcon's angular-top construction (§3.2) rather than a realistic
// rounded cap.
export function GraduationIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5 21 9.4 12 13.8 3 9.4Z" />
      <path d="M7.4 11.4V16c0 1.3 2.1 2.4 4.6 2.4s4.6-1.1 4.6-2.4v-4.6" />
      <path d="M21 9.4V15" />
    </svg>
  );
}

// Feature 24 (FR-441, exercise): a faceted dumbbell — angled end-plates
// echoing §3.2's hexagon vocabulary rather than plain circles.
export function DumbbellIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 9.4 3.6 10.8v2.4L5 14.6M19 9.4l1.4 1.4v2.4L19 14.6" />
      <path d="M7 8.2 5.4 9.8v4.4L7 15.8M17 8.2l1.6 1.6v4.4L17 15.8" />
      <path d="M8.4 12h7.2" />
    </svg>
  );
}

// Feature 24 (FR-442, kids): two overlapping faceted figures — an "extra
// person" reading, built from the same triangular-head construction as
// UserIcon's circle head, angled to fit §3.2.
export function FamilyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="7.2" r="2.6" />
      <path d="M3.4 19c1-3 3.2-4.6 5.6-4.6s4.6 1.6 5.6 4.6" />
      <path d="M15.6 6a2.4 2.4 0 1 1 1.4 4.4" />
      <path d="M16 14.6c2 .3 3.6 1.8 4.4 4.4" />
    </svg>
  );
}

// Feature 24 (FR-443, zodiac): a small girih-hexagon constellation — dots
// on a faceted polygon rather than a realistic star-scatter, matching
// match-moment.tsx's own burst polygon vocabulary.
export function ZodiacIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.6 19 8v8L12 20.4 5 16V8Z" />
      <circle cx="12" cy="3.6" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="16" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="20.4" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="16" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Feature 24 (FR-438, political view): a deliberately neutral compass-needle
// glyph — "a perspective/direction," not a ballot or flag — inside a faceted
// diamond rather than a realistic circular compass face (§3.2).
export function CompassIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 19.8 12 12 21 4.2 12Z" />
      <path d="M14.6 9.4 13 13l-3.6 1.6L11 11Z" />
    </svg>
  );
}

// Feature 24 (FR-446, languages): a faceted globe — angled meridian lines
// on a hexagon silhouette rather than a realistic sphere (§3.2), matching
// SettingsIcon's own hexagon-standing-in-for-a-circle move.
export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3 19.8 7.5V16.5L12 21 4.2 16.5V7.5Z" />
      <path d="M12 3v18M4.2 9.4h15.6M4.2 14.6h15.6" />
      <path d="M12 3c2.4 2.4 3.6 5.8 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.8-3.6-9s1.2-6.6 3.6-9Z" />
    </svg>
  );
}

// Feature 24 (FR-448, drinking — hideable, FR-451): a faceted glass, angled
// walls tying it to §3.2 rather than a realistic tapered cup.
export function GlassIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 4.6h10L15.6 18a1.6 1.6 0 0 1-1.6 1.4h-4a1.6 1.6 0 0 1-1.6-1.4Z" />
      <path d="M7.8 8.6h8.4" />
    </svg>
  );
}

// Feature 24 (FR-449, smoking — hideable, FR-451): recognizable on sight,
// the same deliberate exception to §3.2 as BackIcon/ShareIcon/HelpIcon above
// — a hexagon-vocabulary alternative would read as unfamiliar for this exact
// glyph.
export function CigaretteIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="10.2" width="14" height="3.6" rx="0.6" />
      <path d="M14.6 10.2v3.6" />
      <path d="M19 9.4c.6.8.6 1.8 0 2.6M21 8.2c1.1 1.5 1.1 3.3 0 4.8" />
    </svg>
  );
}
