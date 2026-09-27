"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ExtractedTurnField } from "@/lib/queries/conversational-setup";
import type { UpdateProfileInput } from "@/lib/queries/profile";
import { BirthDateField } from "@/components/profile/birth-date-field";
import { TagInput } from "@/components/profile/tag-input";
import { EditIcon } from "@/components/icons";

type ConfirmValue = Pick<
  UpdateProfileInput,
  "displayName" | "birthDate" | "city" | "bio" | "interests"
>;

/**
 * FR-246/FR-247: the editable AI-proposed-value card — the one real
 * mechanism the whole conversational half of this feature depends on. The
 * user can confirm the AI's value as-is or edit it first; either way,
 * `onConfirm` sends whatever is currently in this card's own state, not a
 * reference to the original proposal.
 */
export function ProposalCard({
  proposed,
  onConfirm,
  pending,
  error,
}: {
  proposed: ExtractedTurnField;
  onConfirm: (value: ConfirmValue) => void;
  pending: boolean;
  error?: string;
}) {
  const t = useTranslations("profile.proposalCard");
  const field = proposed.field;
  const fieldLabel = field ? t(`fields.${field}`) : "";
  const [text, setText] = useState(proposed.stringValue ?? "");
  const [interests, setInterests] = useState(proposed.interestsValue ?? []);
  const [birthDate, setBirthDate] = useState(proposed.birthDateGregorian);
  const [edited, setEdited] = useState(false);

  if (!field) return null;

  function handleConfirm() {
    if (field === "interests") {
      onConfirm({ interests });
    } else if (field === "birthDate") {
      if (birthDate) onConfirm({ birthDate });
    } else {
      onConfirm({ [field as string]: text } as ConfirmValue);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg-value)] border border-[var(--turquoise)] bg-[var(--panel)] p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-[var(--turquoise)]">
        <EditIcon className="h-3.5 w-3.5" />
        <span>{t("suggestionFor", { field: fieldLabel })}</span>
      </div>

      {field === "interests" ? (
        <TagInput
          value={interests}
          onChange={(next) => {
            setInterests(next);
            setEdited(true);
          }}
        />
      ) : field === "birthDate" ? (
        <BirthDateField
          value={birthDate}
          onChange={(iso) => {
            setBirthDate(iso);
            setEdited(true);
          }}
          aiDisplay={proposed.birthDateDisplay ?? undefined}
        />
      ) : field === "bio" ? (
        <textarea
          value={text}
          maxLength={500}
          rows={4}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
          aria-label={fieldLabel}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
        />
      ) : (
        <input
          type="text"
          value={text}
          maxLength={field === "displayName" ? 50 : 100}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
          aria-label={fieldLabel}
          className="rounded-[var(--radius-sm-value)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]"
        />
      )}

      {error ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={pending}
        className="rounded-full bg-[var(--turquoise)] px-4 py-2 text-sm font-extrabold text-[#04211f] disabled:opacity-50"
      >
        {pending ? t("submitting") : edited ? t("confirmEdited") : t("confirm")}
      </button>
    </div>
  );
}
