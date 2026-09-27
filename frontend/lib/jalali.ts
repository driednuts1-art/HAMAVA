import {
  toJalaali,
  toGregorian,
  jalaaliMonthLength,
  type JalaaliDate,
} from "jalaali-js";

// FR-235/FR-236: a thin wrapper, not a UI library — Feature 15's
// birth-date-field.tsx owns the picker UI. This module only owns the
// conversion math, per docs/design-system.md §3.1's "no generic library
// swallows a whole concern" posture.

const PERSIAN_MONTH_NAMES = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
];

export function gregorianIsoToJalali(iso: string): JalaaliDate | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Read UTC components — `iso` is a plain "YYYY-MM-DD" date with no
  // time/zone semantics of its own; using local-time getters here would
  // shift the date near midnight depending on the browser's timezone.
  return toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function jalaliToGregorianIso(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

export function jalaaliMonthLengthSafe(jy: number, jm: number): number {
  return jalaaliMonthLength(jy, jm);
}

export function formatJalaliDisplay(j: JalaaliDate): string {
  return `${j.jd} ${PERSIAN_MONTH_NAMES[j.jm - 1]} ${j.jy}`;
}

export function formatGregorianDisplay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-CA", { timeZone: "UTC" }); // YYYY-MM-DD
}

// Feature 19 (docs/requirements.md FR-380): additive, local-time-aware
// counterparts to the pair above. A birth date (above) has no time/zone
// semantics of its own, so those helpers deliberately read UTC getters — but
// a planned date's `datetime` is a real point in time at the sharer's own
// local clock, and must round-trip through it correctly (an 8pm plan must
// stay 8pm, not shift with the reader's timezone). These read/write local
// getters instead, and additionally carry hour/minute.

export interface JalaliDateTime extends JalaaliDate {
  hour: number;
  minute: number;
}

export function localIsoToJalaliDateTime(iso: string): JalaliDateTime | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const { jy, jm, jd } = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return { jy, jm, jd, hour: d.getHours(), minute: d.getMinutes() };
}

export function jalaliDateTimeToLocalIso(
  jy: number,
  jm: number,
  jd: number,
  hour: number,
  minute: number,
): string {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  // A real local Date, not UTC — the resulting ISO string (via toISOString,
  // called by the consumer) carries the correct real-world instant for
  // whatever timezone this browser is actually in.
  return new Date(gy, gm - 1, gd, hour, minute, 0, 0).toISOString();
}

export function formatJalaliDateTimeDisplay(j: JalaliDateTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatJalaliDisplay(j)} ساعت ${pad(j.hour)}:${pad(j.minute)}`;
}

export function formatGregorianDateTimeDisplay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.toLocaleDateString("en-CA")} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
