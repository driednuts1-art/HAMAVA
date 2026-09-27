import { apiFetch } from "@/lib/api-client";

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type RelationshipGoal =
  | "SERIOUS"
  | "CASUAL"
  | "MARRIAGE_TRACK"
  | "FRIENDSHIP"
  | "NOT_SURE";

// ---- Feature 24: real profile depth — every union below mirrors
// backend/prisma/schema.prisma's own enum exactly (verified by reading the
// real schema, not guessed).

export type Education =
  | "HIGH_SCHOOL"
  | "BACHELORS"
  | "MASTERS"
  | "DOCTORATE"
  | "TRADE_SCHOOL"
  | "OTHER";

export type ExerciseHabit = "NEVER" | "SOMETIMES" | "REGULARLY" | "DAILY";

export type KidsStatus =
  | "HAVE_KIDS"
  | "WANT_KIDS"
  | "HAVE_AND_WANT_MORE"
  | "DONT_WANT_KIDS"
  | "NOT_SURE";

export type ZodiacSign =
  | "ARIES"
  | "TAURUS"
  | "GEMINI"
  | "CANCER"
  | "LEO"
  | "VIRGO"
  | "LIBRA"
  | "SCORPIO"
  | "SAGITTARIUS"
  | "CAPRICORN"
  | "AQUARIUS"
  | "PISCES";

// Feature 24 §10 #3: three deliberately neutral values, not a Western
// left/right axis — a real, explicit user decision (docs/requirements.md
// FR-438).
export type PoliticalView = "NOT_INTERESTED" | "INTERESTED" | "PREFER_NOT_TO_SAY";

export type DrinkingHabit = "NEVER" | "SOMETIMES" | "REGULARLY";
export type SmokingHabit = "NEVER" | "SOMETIMES" | "REGULARLY";

// Mirrors backend/src/modules/profile/dto/update-profile.dto.ts's
// REAL_LANGUAGES exactly — the same fixed, finite list the server validates
// against, no separate endpoint to fetch it from (a real, deliberate call,
// same posture as this file's own enum unions above). Phase 5
// (docs/i18n-rtl-migration-scope.md): translated together with the backend
// enum in the same change, since the frontend sends these values verbatim —
// translating one side alone would send values the other side rejects.
export const REAL_LANGUAGES = [
  "Persian",
  "English",
  "German",
  "French",
  "Arabic",
  "Turkish",
  "Spanish",
] as const;
export type Language = (typeof REAL_LANGUAGES)[number];

export interface PromptAnswer {
  promptId: string;
  answer: string;
}

// Mirrors backend/src/modules/profile/prompts.constants.ts's PromptDefinition.
export interface PromptDefinition {
  id: string;
  question: string;
}

/** FR-433: the one real source of truth for the fixed prompt list. */
export function getPrompts(): Promise<PromptDefinition[]> {
  return apiFetch<PromptDefinition[]>("/v1/profile/prompts");
}

export interface ProfilePhoto {
  id: string;
  position: number;
  url: string;
}

// Mirrors backend/src/modules/profile/profile.service.ts::getProfile's real
// response shape exactly (verified by reading the actual code, not guessed)
// — also what PATCH /v1/profile returns (FR-233).
export interface Profile {
  displayName: string | null;
  birthDate: string | null; // ISO 8601, Gregorian
  city: string | null;
  bio: string | null;
  interests: string[];
  gender: Gender | null;
  datingIntent: RelationshipGoal | null;
  profileCompletedAt: string | null;
  // Feature 29 (FR-504).
  hasSeenWelcomeTour: boolean;
  photos: ProfilePhoto[];
  promptAnswers: PromptAnswer[];
  height: number | null;
  education: Education | null;
  exerciseHabit: ExerciseHabit | null;
  hasKids: KidsStatus | null;
  zodiacSign: ZodiacSign | null;
  politicalView: PoliticalView | null;
  hometown: string | null;
  languages: string[];
  // FR-453/454: the owner's own read always sees their real drinking/smoking
  // regardless of hideDrinkingSmoking — profile.service.ts's getProfile is a
  // separate code path from the candidate-facing mapper that enforces it.
  drinking: DrinkingHabit | null;
  smoking: SmokingHabit | null;
  hideDrinkingSmoking: boolean;
}

export function getProfile(): Promise<Profile> {
  return apiFetch<Profile>("/v1/profile/me");
}

// One shared key, not a literal ["profile"] re-typed at each call site — a
// real gap found investigating a real bug report (docs/requirements.md
// Feature 29 §11): three separate files each defined their own ["profile"]
// react-query key, structurally equal by luck rather than by a single source
// of truth, which is exactly the kind of thing a future edit silently
// breaks cache-sharing on.
export const PROFILE_QUERY_KEY = ["profile"];

// Feature 29 (FR-503): no request body — mirrors the real backend endpoint,
// modeled on who-liked-me's own POST .../seen.
export function markWelcomeTourSeen(): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>("/v1/profile/welcome-tour/seen", {
    method: "POST",
  });
}

export interface UpdateProfileInput {
  displayName?: string;
  birthDate?: string;
  city?: string;
  bio?: string;
  interests?: string[];
  gender?: Gender;
  datingIntent?: RelationshipGoal;
  promptAnswers?: PromptAnswer[];
  height?: number;
  education?: Education;
  exerciseHabit?: ExerciseHabit;
  hasKids?: KidsStatus;
  zodiacSign?: ZodiacSign;
  politicalView?: PoliticalView;
  hometown?: string;
  languages?: string[];
  drinking?: DrinkingHabit;
  smoking?: SmokingHabit;
  hideDrinkingSmoking?: boolean;
}

export function updateProfile(input: UpdateProfileInput): Promise<Profile> {
  return apiFetch<Profile>("/v1/profile", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

interface UploadPhotoResponse {
  id: string;
  position: number;
}

export function uploadPhoto(file: File): Promise<UploadPhotoResponse> {
  const form = new FormData();
  form.append("photo", file);
  // apiFetch sets Content-Type: application/json only when a JSON body is
  // present (lib/api-client.ts) — FormData bodies are left alone so fetch
  // can set the real multipart boundary itself.
  return apiFetch<UploadPhotoResponse>("/v1/profile/photos", {
    method: "POST",
    body: form,
  });
}

export function deletePhoto(id: string): Promise<void> {
  return apiFetch<void>(`/v1/profile/photos/${id}`, { method: "DELETE" });
}
