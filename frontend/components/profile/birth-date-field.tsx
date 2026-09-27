"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toJalaali } from "jalaali-js";
import {
  gregorianIsoToJalali,
  jalaliToGregorianIso,
  jalaaliMonthLengthSafe,
  formatJalaliDisplay,
  formatGregorianDisplay,
} from "@/lib/jalali";

const PERSIAN_MONTHS = [
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

// FR-234/FR-236: one shared component for both the manual form and the
// conversational proposal card — Jalali-first entry, Gregorian always shown
// alongside, never a toggle the user has to switch.
export function BirthDateField({
  value,
  onChange,
  error,
  aiDisplay,
  label,
}: {
  value: string | null;
  onChange: (isoGregorian: string) => void;
  error?: string;
  /** FR-237: the conversational path's own LLM-stated interpretation, shown
   *  alongside this component's independently-computed pair as a deliberate
   *  redundancy — a mismatch is exactly what a human should catch here. */
  aiDisplay?: string;
  label?: string;
}) {
  const t = useTranslations("profile.birthDate");
  const todayJalali = useMemo(() => toJalaali(new Date()), []);
  const parsed = value ? gregorianIsoToJalali(value) : null;

  const [jy, setJy] = useState(parsed?.jy ?? todayJalali.jy - 25);
  const [jm, setJm] = useState(parsed?.jm ?? 1);
  const [jd, setJd] = useState(parsed?.jd ?? 1);

  const monthLength = jalaaliMonthLengthSafe(jy, jm);
  const clampedJd = Math.min(jd, monthLength);

  function commit(nextJy: number, nextJm: number, nextJd: number) {
    const len = jalaaliMonthLengthSafe(nextJy, nextJm);
    const safeJd = Math.min(nextJd, len);
    setJy(nextJy);
    setJm(nextJm);
    setJd(safeJd);
    onChange(jalaliToGregorianIso(nextJy, nextJm, safeJd));
  }

  const gregorianIso = value ?? jalaliToGregorianIso(jy, jm, clampedJd);

  // Sensible dating-app bound (backend independently enforces 18-100) — a
  // shorter, more useful year list, not an arbitrary full calendar range.
  const minYear = todayJalali.jy - 100;
  const maxYear = todayJalali.jy - 18;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i);
  const days = Array.from({ length: monthLength }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold text-[var(--text-faint)]">{label ?? t("label")}</label>
      <div className="flex gap-2">
        <select
          aria-label={t("dayAriaLabel")}
          value={clampedJd}
          onChange={(e) => commit(jy, jm, Number(e.target.value))}
          className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-2 py-2 text-sm text-[var(--text)]"
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          aria-label={t("monthAriaLabel")}
          value={jm}
          onChange={(e) => commit(jy, Number(e.target.value), jd)}
          className="flex-[2] rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-2 py-2 text-sm text-[var(--text)]"
        >
          {PERSIAN_MONTHS.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("yearAriaLabel")}
          value={jy}
          onChange={(e) => commit(Number(e.target.value), jm, jd)}
          className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-2 py-2 text-sm text-[var(--text)]"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {t("gregorianLine", {
          jalali: formatJalaliDisplay({ jy, jm, jd: clampedJd }),
          gregorian: formatGregorianDisplay(gregorianIso),
        })}
      </p>

      {aiDisplay ? (
        <p className="rounded-[var(--radius-sm-value)] bg-[var(--turquoise-dim)] px-3 py-2 text-xs text-[var(--turquoise)]">
          {t("aiInterpretation", { value: aiDisplay })}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
