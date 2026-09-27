import { create } from "zustand";

// FR-206: access token lives only in memory — never localStorage, never
// sessionStorage, never a JS-readable cookie. See docs/requirements.md
// Feature 14 §6.3 for why (Feature 17's WebSocket auth needs a
// client-JS-readable token, ruling out httpOnly for this one).
export interface AuthUser {
  id: string;
  livenessStatus: boolean;
  // Feature 15 FR-225 (Open Items #1, reversed from this doc's original
  // proposal on explicit review direction): "can this user continue past
  // the profile gate?" is session-shaped state, so it lives here — not a
  // separate fetch every screen repeats. Populated alongside
  // livenessStatus at login and on every reload; kept in sync mid-session
  // by setProfileCompleted() whenever a profile mutation crosses the
  // completeness threshold.
  profileCompleted: boolean;
  // Feature 29 (FR-505): the durable "has this user ever actually seen and
  // dismissed the one-time welcome tour" flag — populated alongside
  // profileCompleted, kept in sync by setWelcomeTourSeen() once the tour is
  // dismissed. Deliberately not a live "just transitioned" event: a user
  // who closes the app before dismissing must still see it next session.
  hasSeenWelcomeTour: boolean;
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
  status: "unknown" | "authenticated" | "unauthenticated";
  setSession: (accessToken: string, user: AuthUser) => void;
  setAccessToken: (accessToken: string) => void;
  setProfileCompleted: (completed: boolean) => void;
  setWelcomeTourSeen: (seen: boolean) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  status: "unknown",
  setSession: (accessToken, user) =>
    set({ accessToken, user, status: "authenticated" }),
  // FR-208/FR-204: a proactive or reactive refresh rotates the access token
  // without a fresh /otp/verify — there's no new `user` payload to apply.
  setAccessToken: (accessToken) => set({ accessToken }),
  setProfileCompleted: (completed) =>
    set((state) =>
      state.user ? { user: { ...state.user, profileCompleted: completed } } : state,
    ),
  setWelcomeTourSeen: (seen) =>
    set((state) =>
      state.user ? { user: { ...state.user, hasSeenWelcomeTour: seen } } : state,
    ),
  clearSession: () =>
    set({ accessToken: null, user: null, status: "unauthenticated" }),
}));
