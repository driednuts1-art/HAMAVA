"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { uploadPhoto, deletePhoto, type ProfilePhoto } from "@/lib/queries/profile";
import { ApiRequestError } from "@/lib/api-error";
import { CameraIcon, TrashIcon } from "@/components/icons";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // PROFILE_MAX_UPLOAD_BYTES default — real ceiling is server-validated
const MAX_PHOTOS = 6; // PROFILE_MAX_PHOTOS default — real ceiling is server-validated (FR-240)

/**
 * FR-238..FR-242: real multipart upload/delete against the real backend.
 * No reorder control (`docs/requirements.md` Feature 15 §4, `docs/roadmap.md`
 * item 14 — no backend endpoint exists for it) — photos render in the
 * backend's own `position` order, append-only.
 */
export function PhotoGrid({
  photos,
  onChanged,
}: {
  photos: ProfilePhoto[];
  onChanged: () => void;
}) {
  const t = useTranslations("profile.photoGrid");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: uploadPhoto,
    onSuccess: () => {
      setLocalError(null);
      onChanged();
    },
  });

  // Real bug report: a photo upload is its own independent mutation and
  // never touches ProfileForm's `patch` state, so its "ذخیره" button stays
  // disabled and gave zero feedback that the upload actually succeeded —
  // confirmed live (POST /v1/profile/photos → 201, button still disabled).
  // This message is the fix: explicit, upload-scoped success feedback that
  // doesn't depend on the unrelated Save button at all. `isSuccess` clears
  // on its own the moment another upload starts (react-query resets mutation
  // status back to pending on a fresh `mutate()` call).
  const showUploadSuccess = uploadMutation.isSuccess && !uploadMutation.isPending;

  const deleteMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => onChanged(),
  });

  function handleFileSelected(file: File) {
    setLocalError(null);
    // FR-238: client-side pre-validation only avoids an upload doomed to
    // fail — the backend's own sharp-decode check remains the real authority.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLocalError(t("invalidType"));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(t("tooLarge"));
      return;
    }
    uploadMutation.mutate(file);
  }

  const atLimit = photos.length >= MAX_PHOTOS;
  const uploadError =
    uploadMutation.error instanceof ApiRequestError
      ? uploadMutation.error.problem
      : null;
  // FR-240: the backend's real 409 at PROFILE_MAX_PHOTOS surfaces as its own message.
  const limitMessage =
    uploadError?.status === 409 ? uploadError.detail : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {photos
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((photo) => (
            <div
              key={photo.id}
              className="relative aspect-square overflow-hidden rounded-[var(--radius-md-value)] border border-[var(--border)] shadow-elevation-1"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a
                  freshly-signed, short-lived S3 URL (Feature 2 FR-89);
                  next/image's remote-pattern allowlist would need the real
                  storage host configured for no real benefit here. */}
              <img
                src={photo.url}
                alt=""
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t("confirmDelete"))) {
                    deleteMutation.mutate(photo.id);
                  }
                }}
                aria-label={t("deletePhoto")}
                className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-deep)]/80 text-[var(--danger)]"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

        {!atLimit ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
            aria-label={t("addPhoto")}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[var(--radius-md-value)] border border-dashed border-[var(--border)] text-[var(--text-muted)] shadow-elevation-1 disabled:opacity-50 disabled:shadow-none"
          >
            <CameraIcon className="h-6 w-6" />
            <span className="text-xs">
              {uploadMutation.isPending ? t("uploading") : t("add")}
            </span>
          </button>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileSelected(file);
          e.target.value = "";
        }}
      />

      {showUploadSuccess ? (
        <p role="status" aria-live="polite" className="text-xs text-[var(--turquoise)]">
          {t("uploadSuccess")}
        </p>
      ) : null}
      {localError ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {localError}
        </p>
      ) : null}
      {limitMessage ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {limitMessage}
        </p>
      ) : null}
      {uploadError && !limitMessage ? (
        <p role="alert" className="text-xs text-[var(--rose)]">
          {uploadError.detail}
        </p>
      ) : null}
    </div>
  );
}
