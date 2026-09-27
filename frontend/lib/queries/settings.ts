import { apiFetch } from "@/lib/api-client";

// Mirrors backend/src/modules/settings/settings.service.ts and
// account-deletion.service.ts exactly (verified by reading the real running
// code) — docs/requirements.md Feature 20 §1/§6.

export type MessagingPermission = "EVERYONE" | "VERIFIED_ONLY";

export interface UserSettings {
  preciseLocationEnabled: boolean;
  messagingPermission: MessagingPermission;
  notifyOnNewMatch: boolean;
  notifyOnNewMessage: boolean;
  notifyOnSafetyAlert: boolean;
  allowInSafetyShares: boolean;
  showLastActiveStatus: boolean;
}

export function getSettings(): Promise<UserSettings> {
  return apiFetch<UserSettings>("/v1/users/me/settings");
}

export interface UpdatePrivacyInput {
  preciseLocationEnabled?: boolean;
  messagingPermission?: MessagingPermission;
  allowInSafetyShares?: boolean;
  showLastActiveStatus?: boolean;
}

export function updatePrivacy(input: UpdatePrivacyInput): Promise<UserSettings> {
  return apiFetch<UserSettings>("/v1/users/me/privacy", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface UpdateNotificationsInput {
  notifyOnNewMatch?: boolean;
  notifyOnNewMessage?: boolean;
  notifyOnSafetyAlert?: boolean;
}

export function updateNotifications(
  input: UpdateNotificationsInput,
): Promise<UserSettings> {
  return apiFetch<UserSettings>("/v1/users/me/notifications", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// FR-417: deliberately NOT verifyOtp() (lib/queries/auth.ts) — that
// function establishes a *new* login session (sets the httpOnly cookie,
// populates useAuthStore), the wrong action here. This call is authenticated
// by the caller's own already-existing access token (apiFetch attaches it
// as usual); {phone, code} is only the real OTP re-verification body
// (Feature 6 FR-83).
export function deleteAccount(phone: string, code: string): Promise<void> {
  return apiFetch<void>("/v1/users/me", {
    method: "DELETE",
    body: JSON.stringify({ phone, code }),
  });
}
