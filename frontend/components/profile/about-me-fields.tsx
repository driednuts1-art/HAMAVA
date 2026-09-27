"use client";

import { useTranslations } from "next-intl";
import type {
  DrinkingHabit,
  Education,
  ExerciseHabit,
  KidsStatus,
  PoliticalView,
  SmokingHabit,
  ZodiacSign,
} from "@/lib/queries/profile";
import { REAL_LANGUAGES } from "@/lib/queries/profile";
import {
  CompassIcon,
  DumbbellIcon,
  FamilyIcon,
  GlassIcon,
  GlobeIcon,
  GraduationIcon,
  CigaretteIcon,
  LocationIcon,
  RulerIcon,
  ZodiacIcon,
} from "@/components/icons";

// Exported as functions, not plain arrays, for reuse by CandidateCard (label
// lookup for a candidate's own about-me tags) — one real source of truth for
// these labels, not a second hardcoded copy. Functions, not module-level
// constants, because the labels now come from next-intl's useTranslations(),
// a React hook that can't run at module scope — each caller gets its own
// `t` from its own component and passes it in here.
type TFn = (key: string) => string;

export function getEducationOptions(t: TFn): { value: Education; label: string }[] {
  return (["HIGH_SCHOOL", "BACHELORS", "MASTERS", "DOCTORATE", "TRADE_SCHOOL", "OTHER"] as const).map(
    (value) => ({ value, label: t(`options.education.${value}`) }),
  );
}

export function getExerciseOptions(t: TFn): { value: ExerciseHabit; label: string }[] {
  return (["NEVER", "SOMETIMES", "REGULARLY", "DAILY"] as const).map((value) => ({
    value,
    label: t(`options.exercise.${value}`),
  }));
}

export function getKidsOptions(t: TFn): { value: KidsStatus; label: string }[] {
  return (
    ["HAVE_KIDS", "HAVE_AND_WANT_MORE", "WANT_KIDS", "DONT_WANT_KIDS", "NOT_SURE"] as const
  ).map((value) => ({ value, label: t(`options.kids.${value}`) }));
}

export function getZodiacOptions(t: TFn): { value: ZodiacSign; label: string }[] {
  return (
    [
      "ARIES",
      "TAURUS",
      "GEMINI",
      "CANCER",
      "LEO",
      "VIRGO",
      "LIBRA",
      "SCORPIO",
      "SAGITTARIUS",
      "CAPRICORN",
      "AQUARIUS",
      "PISCES",
    ] as const
  ).map((value) => ({ value, label: t(`options.zodiac.${value}`) }));
}

// Feature 24 §10 #3: the exact 3 neutral labels the user chose, matching
// PoliticalView's real enum values one-to-one.
export function getPoliticalOptions(t: TFn): { value: PoliticalView; label: string }[] {
  return (["NOT_INTERESTED", "INTERESTED", "PREFER_NOT_TO_SAY"] as const).map((value) => ({
    value,
    label: t(`options.political.${value}`),
  }));
}

export function getDrinkingOptions(t: TFn): { value: DrinkingHabit; label: string }[] {
  return (["NEVER", "SOMETIMES", "REGULARLY"] as const).map((value) => ({
    value,
    label: t(`options.drinking.${value}`),
  }));
}

export function getSmokingOptions(t: TFn): { value: SmokingHabit; label: string }[] {
  return (["NEVER", "SOMETIMES", "REGULARLY"] as const).map((value) => ({
    value,
    label: t(`options.smoking.${value}`),
  }));
}

export interface AboutMeValues {
  height: number | null;
  education: Education | "";
  exerciseHabit: ExerciseHabit | "";
  hasKids: KidsStatus | "";
  zodiacSign: ZodiacSign | "";
  politicalView: PoliticalView | "";
  hometown: string;
  languages: string[];
  drinking: DrinkingHabit | "";
  smoking: SmokingHabit | "";
  hideDrinkingSmoking: boolean;
}

const selectClass =
  "flex-1 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)] shadow-elevation-1 outline-none focus-visible:shadow-elevation-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--turquoise)]";

function IconSelect<T extends string>({
  icon,
  label,
  value,
  options,
  onChange,
  notSetLabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T | "") => void;
  notSetLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--turquoise)]">
        {icon}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T | "")}
        aria-label={label}
        className={selectClass}
      >
        <option value="">
          {label} — {notSetLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Feature 24 (FR-437..FR-451): every "about me" tag is optional — an empty
 * select (mapped to `undefined`, never sent in the PATCH body) is a
 * perfectly valid end state, not a validation error (product decision:
 * these are depth, not requirements).
 */
export function AboutMeFields({
  values,
  onChange,
}: {
  values: AboutMeValues;
  onChange: <K extends keyof AboutMeValues>(key: K, value: AboutMeValues[K]) => void;
}) {
  const t = useTranslations("profile.aboutMe");
  function toggleLanguage(lang: string) {
    onChange(
      "languages",
      values.languages.includes(lang)
        ? values.languages.filter((l) => l !== lang)
        : [...values.languages, lang],
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-sm font-extrabold text-[var(--text)]">{t("heading")}</h3>

      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--turquoise)]">
          <RulerIcon className="h-4 w-4" />
        </span>
        <input
          type="number"
          min={140}
          max={220}
          value={values.height ?? ""}
          onChange={(e) =>
            onChange("height", e.target.value === "" ? null : Number(e.target.value))
          }
          placeholder={t("heightPlaceholder")}
          aria-label={t("height")}
          className={selectClass}
        />
      </div>

      <IconSelect
        icon={<GraduationIcon className="h-4 w-4" />}
        label={t("education")}
        notSetLabel={t("notSet")}
        value={values.education}
        options={getEducationOptions(t)}
        onChange={(v) => onChange("education", v)}
      />

      <IconSelect
        icon={<DumbbellIcon className="h-4 w-4" />}
        label={t("exercise")}
        notSetLabel={t("notSet")}
        value={values.exerciseHabit}
        options={getExerciseOptions(t)}
        onChange={(v) => onChange("exerciseHabit", v)}
      />

      <IconSelect
        icon={<FamilyIcon className="h-4 w-4" />}
        label={t("kids")}
        notSetLabel={t("notSet")}
        value={values.hasKids}
        options={getKidsOptions(t)}
        onChange={(v) => onChange("hasKids", v)}
      />

      <IconSelect
        icon={<ZodiacIcon className="h-4 w-4" />}
        label={t("zodiac")}
        notSetLabel={t("notSet")}
        value={values.zodiacSign}
        options={getZodiacOptions(t)}
        onChange={(v) => onChange("zodiacSign", v)}
      />

      <IconSelect
        icon={<CompassIcon className="h-4 w-4" />}
        label={t("politicalView")}
        notSetLabel={t("notSet")}
        value={values.politicalView}
        options={getPoliticalOptions(t)}
        onChange={(v) => onChange("politicalView", v)}
      />

      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--turquoise)]">
          <LocationIcon className="h-4 w-4" />
        </span>
        <input
          type="text"
          maxLength={100}
          value={values.hometown}
          onChange={(e) => onChange("hometown", e.target.value)}
          placeholder={t("hometown")}
          aria-label={t("hometown")}
          className={selectClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--turquoise)]">
            <GlobeIcon className="h-4 w-4" />
          </span>
          <span className="text-xs font-bold text-[var(--text-faint)]">{t("languages")}</span>
        </div>
        <div className="flex flex-wrap gap-2 pl-12">
          {REAL_LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              aria-pressed={values.languages.includes(lang)}
              onClick={() => toggleLanguage(lang)}
              className={
                "rounded-full px-3 py-1.5 text-xs font-bold " +
                (values.languages.includes(lang)
                  ? "bg-[var(--turquoise)] text-[#04211f]"
                  : "bg-[var(--surface)] text-[var(--text-muted)]")
              }
            >
              {lang}
            </button>
          ))}
        </div>
      </div>

      {/* FR-448..FR-451: drinking/smoking are grouped under one hide toggle
          — hiding is a single category decision, not two independent ones. */}
      <div className="flex flex-col gap-3 rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--panel)] p-3 shadow-elevation-1">
        <IconSelect
          icon={<GlassIcon className="h-4 w-4" />}
          label={t("drinking")}
          notSetLabel={t("notSet")}
          value={values.drinking}
          options={getDrinkingOptions(t)}
          onChange={(v) => onChange("drinking", v)}
        />
        <IconSelect
          icon={<CigaretteIcon className="h-4 w-4" />}
          label={t("smoking")}
          notSetLabel={t("notSet")}
          value={values.smoking}
          options={getSmokingOptions(t)}
          onChange={(v) => onChange("smoking", v)}
        />
        <label className="flex items-center justify-between pl-12">
          <span className="text-xs font-bold text-[var(--text-faint)]">
            {t("hideDrinkingSmoking")}
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--turquoise)]"
            checked={values.hideDrinkingSmoking}
            onChange={(e) => onChange("hideDrinkingSmoking", e.target.checked)}
            aria-label={t("hideDrinkingSmokingAriaLabel")}
          />
        </label>
      </div>
    </div>
  );
}
