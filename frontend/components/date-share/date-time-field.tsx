"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toJalaali } from "jalaali-js";
import {
  jalaaliMonthLengthSafe,
  jalaliDateTimeToLocalIso,
  localIsoToJalaliDateTime,
  formatJalaliDateTimeDisplay,
  formatGregorianDateTimeDisplay,
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

// FR-380: a genuinely new component, not a reskin of Feature 15's
// BirthDateField — that one is deliberately calendar-date-only (a birth date
// has no time/zone semantics). This field captures a real local point in
// time (day + hour + minute) and must round-trip correctly through it, so it
// uses lib/jalali.ts's new local-time-aware helpers, not the UTC-getter-based
// ones BirthDateField itself uses.
export function DateTimeField({
  value,
  onChange,
  error,
}: {
  value: string | null;
  onChange: (localIso: string) => void;
  error?: string;
}) {
  const t = useTranslations("dateShare.dateTimeField");
  const now = new Date();
  const todayJalali = toJalaali(now);
  const parsed = value ? localIsoToJalaliDateTime(value) : null;

  const [jy, setJy] = useState(parsed?.jy ?? todayJalali.jy);
  const [jm, setJm] = useState(parsed?.jm ?? todayJalali.jm);
  const [jd, setJd] = useState(parsed?.jd ?? todayJalali.jd);
  const [hour, setHour] = useState(parsed?.hour ?? now.getHours());
  const [minute, setMinute] = useState(parsed?.minute ?? now.getMinutes());

  const monthLength = jalaaliMonthLengthSafe(jy, jm);
  const isCurrentYearMonth = jy === todayJalali.jy && jm === todayJalali.jm;
  const firstSelectableDay = isCurrentYearMonth ? todayJalali.jd : 1;
  const clampedJd = Math.min(Math.max(jd, firstSelectableDay), monthLength);

  function commit(
    nextJy: number,
    nextJm: number,
    nextJd: number,
    nextHour: number,
    nextMinute: number,
  ) {
    const len = jalaaliMonthLengthSafe(nextJy, nextJm);
    const nextFirstSelectable =
      nextJy === todayJalali.jy && nextJm === todayJalali.jm ? todayJalali.jd : 1;
    const safeJd = Math.min(Math.max(nextJd, nextFirstSelectable), len);
    setJy(nextJy);
    setJm(nextJm);
    setJd(safeJd);
    setHour(nextHour);
    setMinute(nextMinute);
    onChange(jalaliDateTimeToLocalIso(nextJy, nextJm, safeJd, nextHour, nextMinute));
  }

  const localIso =
    value ?? jalaliDateTimeToLocalIso(jy, jm, clampedJd, hour, minute);

  // FR-381: the earliest selectable day is genuinely bounded to today — the
  // real backend 400 (a past datetime) still applies independently, this is
  // a real input-level constraint, not a decorative one. Years below today's
  // are structurally absent from the dropdown entirely (minYear below); within
  // the current year+month specifically, days before today are also excluded
  // — the one real, common accidental-mistake case worth guarding client-side.
  // Not extended to a full cascading month-lock (excluding past months
  // within the current year): the backend's own 400 is the real, final
  // authority regardless, and that additional complexity isn't worth it for
  // a purely client-side UX nicety.
  const minYear = todayJalali.jy;
  const maxYear = todayJalali.jy + 2;
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  const days = Array.from(
    { length: monthLength - firstSelectableDay + 1 },
    (_, i) => firstSelectableDay + i,
  );
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold text-[var(--text-faint)]">{t("label")}</label>
      <div className="flex gap-2">
        <select
          aria-label={t("dayAriaLabel")}
          value={clampedJd}
          onChange={(e) => commit(jy, jm, Number(e.target.value), hour, minute)}
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
          onChange={(e) => commit(jy, Number(e.target.value), jd, hour, minute)}
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
          onChange={(e) => commit(Number(e.target.value), jm, jd, hour, minute)}
          className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-2 py-2 text-sm text-[var(--text)]"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <select
          aria-label={t("hourAriaLabel")}
          value={hour}
          onChange={(e) => commit(jy, jm, jd, Number(e.target.value), minute)}
          className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-2 py-2 text-sm text-[var(--text)]"
        >
          {hours.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--text-muted)]">:</span>
        <select
          aria-label={t("minuteAriaLabel")}
          value={minute}
          onChange={(e) => commit(jy, jm, jd, hour, Number(e.target.value))}
          className="flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-2 py-2 text-sm text-[var(--text)]"
        >
          {minutes.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {t("gregorianLine", {
          jalali: formatJalaliDateTimeDisplay({ jy, jm, jd: clampedJd, hour, minute }),
          gregorian: formatGregorianDateTimeDisplay(localIso),
        })}
      </p>

      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
