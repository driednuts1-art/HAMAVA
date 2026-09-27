import { apiFetch } from "@/lib/api-client";

// Mirrors backend/src/modules/calls/* exactly (verified by reading the real
// code) — docs/requirements.md Feature 18 §1/§8.

export type CallType = "VOICE" | "VIDEO";

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface StartCallResult {
  callSessionId: string;
  iceServers: IceServer[];
  durationLimitSeconds: number | null;
}

export interface JoinCallResult {
  iceServers: IceServer[];
  durationLimitSeconds: number | null;
}

export function startCall(matchId: string, type: CallType): Promise<StartCallResult> {
  return apiFetch<StartCallResult>(`/v1/calls/${matchId}/start`, {
    method: "POST",
    body: JSON.stringify({ type }),
  });
}

export function joinCall(matchId: string, callSessionId: string): Promise<JoinCallResult> {
  return apiFetch<JoinCallResult>(`/v1/calls/${matchId}/${callSessionId}/join`, {
    method: "POST",
  });
}

// FR-368/369 (connectionType/qualityStatsRef, real getStats()-derived data),
// FR-366 (endReason — Feature 18 §8's new, narrowly-validated backend field:
// only a real client-observable fact about a call this client was a
// participant in, never the server-owned 'COMPLETED'/'MISSED').
export function endCall(
  matchId: string,
  callSessionId: string,
  input: {
    connectionType?: "p2p" | "relayed";
    qualityStatsRef?: string;
    endReason?: "DECLINED" | "DURATION_LIMIT_REACHED";
  } = {},
): Promise<void> {
  return apiFetch<void>(`/v1/calls/${matchId}/${callSessionId}/end`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ActiveCall {
  callSessionId: string;
  type: CallType;
  status: "RINGING" | "ACTIVE" | "ENDED";
}

export function getActiveCall(matchId: string): Promise<ActiveCall | null> {
  return apiFetch<ActiveCall | null>(`/v1/calls/${matchId}/active`).then(
    (result) => result ?? null,
  );
}
