import { create } from "zustand";
import type { CallType } from "./queries/calls";

// FR-344: a plain Zustand store, mirroring auth-store.ts's own precedent —
// state that needs to be read outside React's render cycle (lib/webrtc.ts's
// socket event handlers, specifically), not React context.

export type CallPhase =
  | "idle"
  | "ringing-incoming"
  | "ringing-outgoing"
  | "connecting"
  | "active"
  | "ended";

export interface CallOtherUser {
  id: string;
  displayName: string | null;
  primaryPhotoUrl: string | null;
  verified: boolean;
}

export type CallErrorKind =
  | "permission-denied"
  | "vendor-unavailable"
  | "call-unavailable"
  | "rate-limited"
  | "forbidden"
  | "connection-failed"
  | "declined"
  | "missed";

interface CallState {
  phase: CallPhase;
  callSessionId: string | null;
  matchId: string | null;
  type: CallType | null;
  isInitiator: boolean;
  otherUser: CallOtherUser | null;
  durationLimitSeconds: number | null;
  error: { kind: CallErrorKind; detail: string } | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connectionState: RTCPeerConnectionState | null;

  setPhase: (phase: CallPhase) => void;
  setCallSession: (input: {
    callSessionId: string;
    matchId: string;
    type: CallType;
    isInitiator: boolean;
    otherUser: CallOtherUser;
    durationLimitSeconds: number | null;
  }) => void;
  setStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  setConnectionState: (state: RTCPeerConnectionState | null) => void;
  setError: (error: { kind: CallErrorKind; detail: string } | null) => void;
  reset: () => void;
}

const initialState = {
  phase: "idle" as CallPhase,
  callSessionId: null,
  matchId: null,
  type: null,
  isInitiator: false,
  otherUser: null,
  durationLimitSeconds: null,
  error: null,
  localStream: null,
  remoteStream: null,
  connectionState: null,
};

export const useCallStore = create<CallState>((set) => ({
  ...initialState,
  setPhase: (phase) => set({ phase }),
  setCallSession: (input) => set({ ...input, phase: "connecting", error: null }),
  setStreams: (localStream, remoteStream) => set({ localStream, remoteStream }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setError: (error) => set({ error }),
  reset: () => set({ ...initialState }),
}));
