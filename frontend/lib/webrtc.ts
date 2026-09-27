import { useCallStore, type CallOtherUser } from "./call-store";
import { startCall, joinCall, endCall, type CallType, type IceServer } from "./queries/calls";
import { ApiRequestError } from "./api-error";
import {
  onCallIncoming,
  onCallLimitReached,
  onCallSignal,
  onCallHangup,
  emitCallSignal,
  emitCallHangup,
  type CallIncomingPayload,
} from "./websocket-client";

// FR-351..357: the real RTCPeerConnection lifecycle. A module-level
// singleton controller (mirroring websocket-client.ts's own style — plain
// exported functions over module state, not a class), since exactly one
// call can ever be active at a time (FR-347).
//
// Real signaling handshake, worked out precisely during implementation —
// refines docs/requirements.md FR-352's original wording, which undersold
// a real ordering constraint: the *caller* has no server signal telling it
// the callee ever joined (`join`'s 201 response goes only to the joining
// client), so the caller cannot be the one to initiate the SDP offer on
// "join" — nothing tells it when that happened. The callee, having just
// received its own real 201 from `join`, is the one real, concrete signal
// either side gets that both parties are actually engaged — so the callee
// creates and sends the real offer; the caller answers. Whoever *called*
// is irrelevant to WebRTC's own offerer/answerer roles.

type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let otherUserId: string | null = null;
let pendingRemoteCandidates: RTCIceCandidateInit[] = [];
let limitTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function clearLimitTimer(): void {
  if (limitTimer) clearTimeout(limitTimer);
  limitTimer = null;
}

/** FR-357: always torn down on every real exit path. */
function teardownConnection(): void {
  clearLimitTimer();
  pc?.close();
  pc = null;
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  otherUserId = null;
  pendingRemoteCandidates = [];
}

async function getLocalMedia(type: CallType): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: type === "VIDEO",
  });
}

function toRtcIceServers(servers: IceServer[]): RTCIceServer[] {
  return servers.map((s) => ({
    urls: s.urls,
    username: s.username,
    credential: s.credential,
  }));
}

function createPeerConnection(iceServers: IceServer[], toUserId: string, callSessionId: string): RTCPeerConnection {
  const connection = new RTCPeerConnection({ iceServers: toRtcIceServers(iceServers) });

  connection.onicecandidate = (event) => {
    if (!event.candidate) return;
    emitCallSignal({
      callSessionId,
      toUserId,
      payload: { kind: "ice-candidate", candidate: event.candidate.toJSON() } satisfies SignalPayload,
    });
  };

  connection.ontrack = (event) => {
    useCallStore.getState().setStreams(localStream, event.streams[0] ?? null);
  };

  connection.onconnectionstatechange = () => {
    useCallStore.getState().setConnectionState(connection.connectionState);
    if (connection.connectionState === "connected") {
      useCallStore.getState().setPhase("active");
      const limitSeconds = useCallStore.getState().durationLimitSeconds;
      if (limitSeconds !== null) {
        // FR-365/366: a real local timer, computed from the real value the
        // backend already sent — independent of whether the server's own
        // call:limit-reached push ever arrives (FR-367).
        clearLimitTimer();
        limitTimer = setTimeout(() => {
          void endActiveCall("DURATION_LIMIT_REACHED");
        }, limitSeconds * 1000);
      }
    } else if (connection.connectionState === "failed") {
      // FR-355: a real ICE/connection failure ends the call, never left
      // connecting indefinitely.
      useCallStore.getState().setError({
        kind: "connection-failed",
        detail: "The call connection failed.",
      });
      void endActiveCall("COMPLETED_LOCAL_FAILURE");
    }
  };

  return connection;
}

async function flushPendingCandidates(): Promise<void> {
  if (!pc?.remoteDescription) return;
  const queued = pendingRemoteCandidates;
  pendingRemoteCandidates = [];
  for (const candidate of queued) {
    await pc.addIceCandidate(candidate);
  }
}

function apiErrorToCallError(err: unknown): { kind: import("./call-store").CallErrorKind; detail: string } {
  if (err instanceof ApiRequestError) {
    const status = err.problem.status;
    if (status === 503) return { kind: "vendor-unavailable", detail: err.problem.detail };
    if (status === 409) return { kind: "call-unavailable", detail: err.problem.detail };
    if (status === 429) return { kind: "rate-limited", detail: err.problem.detail };
    if (status === 403 || status === 404) return { kind: "forbidden", detail: err.problem.detail };
    return { kind: "connection-failed", detail: err.problem.detail };
  }
  return { kind: "connection-failed", detail: "An unexpected error occurred." };
}

/** FR-345: called once, from app/(tabs)/layout.tsx — the same mount point
 * Feature 17's useChatConnection() lives at, so an incoming call is caught
 * from anywhere in the app, not just inside the relevant conversation. */
export function initCallListening(): void {
  if (listening) return;
  listening = true;

  onCallIncoming((payload: CallIncomingPayload) => {
    // FR-347: at most one call tracked at a time.
    if (useCallStore.getState().phase !== "idle") {
      console.warn("Ignored a real call:incoming while another call was already in progress.", payload);
      return;
    }
    otherUserId = payload.fromUserId;
    useCallStore.setState({
      phase: "ringing-incoming",
      callSessionId: payload.callSessionId,
      matchId: payload.matchId,
      type: payload.type,
      isInitiator: false,
      // otherUser is resolved by the incoming-call overlay itself from the
      // real conversations list (FR-345) — this event only carries the id.
      otherUser: { id: payload.fromUserId, displayName: null, primaryPhotoUrl: null, verified: false },
      durationLimitSeconds: null,
      error: null,
    });
  });

  onCallSignal(async (payload) => {
    const state = useCallStore.getState();
    if (payload.callSessionId !== state.callSessionId || !pc) return;
    const signal = payload.payload as SignalPayload;
    if (signal.kind === "offer") {
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      emitCallSignal({
        callSessionId: payload.callSessionId,
        toUserId: payload.fromUserId,
        payload: { kind: "answer", sdp: answer.sdp! } satisfies SignalPayload,
      });
    } else if (signal.kind === "answer") {
      await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      await flushPendingCandidates();
    } else if (signal.kind === "ice-candidate") {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(signal.candidate);
      } else {
        pendingRemoteCandidates.push(signal.candidate);
      }
    }
  });

  onCallHangup((payload) => {
    const state = useCallStore.getState();
    if (payload.callSessionId !== state.callSessionId) return;
    teardownConnection();
    if (payload.reason === "DECLINED") {
      useCallStore.getState().setError({ kind: "declined", detail: "Call declined." });
    }
    useCallStore.getState().setPhase("ended");
  });

  onCallLimitReached((payload) => {
    // FR-367: the redundant, independent second trigger — a no-op if
    // FR-366's own client-computed timer already ended the call.
    const state = useCallStore.getState();
    if (payload.callSessionId !== state.callSessionId || state.phase !== "active") return;
    void endActiveCall("DURATION_LIMIT_REACHED");
  });
}

/** FR-351/6.2: called from the conversation header's call buttons. */
export async function startOutgoingCall(
  matchId: string,
  type: CallType,
  otherUser: CallOtherUser,
): Promise<void> {
  try {
    const result = await startCall(matchId, type);
    otherUserId = otherUser.id;
    useCallStore.setState({
      phase: "ringing-outgoing",
      callSessionId: result.callSessionId,
      matchId,
      type,
      isInitiator: true,
      otherUser,
      durationLimitSeconds: result.durationLimitSeconds,
      error: null,
    });
    const stream = await getLocalMedia(type).catch((err: unknown) => {
      useCallStore.getState().setError({ kind: "permission-denied", detail: "Microphone/camera access was denied." });
      throw err;
    });
    localStream = stream;
    pc = createPeerConnection(result.iceServers, otherUser.id, result.callSessionId);
    stream.getTracks().forEach((track) => pc!.addTrack(track, stream));
    useCallStore.getState().setStreams(stream, null);
    // No offer yet — the callee's own join is the real signal that starts
    // negotiation (see this file's own header comment).
  } catch (err) {
    if (!(err instanceof DOMException)) {
      useCallStore.getState().setError(apiErrorToCallError(err));
    }
    teardownConnection();
    useCallStore.getState().setPhase("ended");
  }
}

/** FR-346: accepting the real incoming-call overlay. */
export async function acceptIncomingCall(): Promise<void> {
  const state = useCallStore.getState();
  if (!state.callSessionId || !state.matchId || !state.type || !otherUserId) return;
  try {
    const result = await joinCall(state.matchId, state.callSessionId);
    useCallStore.setState({ durationLimitSeconds: result.durationLimitSeconds, phase: "connecting", error: null });
    const stream = await getLocalMedia(state.type).catch((err: unknown) => {
      useCallStore.getState().setError({ kind: "permission-denied", detail: "Microphone/camera access was denied." });
      throw err;
    });
    localStream = stream;
    pc = createPeerConnection(result.iceServers, otherUserId, state.callSessionId);
    stream.getTracks().forEach((track) => pc!.addTrack(track, stream));
    useCallStore.getState().setStreams(stream, null);

    // The callee is the real, concrete signal both sides are engaged —
    // create and send the real offer now.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    emitCallSignal({
      callSessionId: state.callSessionId,
      toUserId: otherUserId,
      payload: { kind: "offer", sdp: offer.sdp! } satisfies SignalPayload,
    });
  } catch (err) {
    if (!(err instanceof DOMException)) {
      useCallStore.getState().setError(apiErrorToCallError(err));
    }
    teardownConnection();
    useCallStore.getState().setPhase("ended");
  }
}

/** FR-346: declining without ever calling join — the backend's own real
 * lazy-expiry (or, once ended, a real DECLINED reason) is what records it.
 *
 * A real gap found while writing this feature's own e2e test, not in the
 * original draft: nothing here notified the *caller* in real time — no
 * RTCPeerConnection exists yet on the callee's side to fail, so the caller
 * would have sat in "ringing-outgoing" until the real 60s server-side
 * ringing timeout, not a real decline. `call:hangup` is a pure signaling
 * event, not tied to an active peer connection, so it's the right real
 * mechanism here too — the caller's own onCallHangup handler already
 * tears down its "ringing-outgoing" state correctly on any reason. */
export function declineIncomingCall(): void {
  const state = useCallStore.getState();
  if (state.callSessionId && state.matchId && otherUserId) {
    emitCallHangup({ callSessionId: state.callSessionId, reason: "DECLINED" });
    void endCall(state.matchId, state.callSessionId, { endReason: "DECLINED" }).catch(() => {
      // Fail-open: a failed decline-reporting call must never block the UI
      // from returning to idle — the ringing timeout is the real fallback.
    });
  }
  teardownConnection();
  useCallStore.getState().reset();
}

async function computeEndReport(): Promise<{ connectionType: "p2p" | "relayed"; qualityStatsRef: string } | null> {
  if (!pc) return null;
  try {
    const stats = await pc.getStats();
    let connectionType: "p2p" | "relayed" = "p2p";
    let roundTripTimeMs: number | null = null;
    let packetsLost = 0;
    stats.forEach((report) => {
      if (report.type === "candidate-pair" && (report as RTCIceCandidatePairStats).state === "succeeded") {
        const pair = report as RTCIceCandidatePairStats & { localCandidateId?: string };
        if (typeof pair.currentRoundTripTime === "number") {
          roundTripTimeMs = Math.round(pair.currentRoundTripTime * 1000);
        }
      }
      if (
        report.type === "local-candidate" &&
        (report as RTCStats & { candidateType?: string }).candidateType === "relay"
      ) {
        connectionType = "relayed";
      }
      if (report.type === "inbound-rtp") {
        const inbound = report as RTCInboundRtpStreamStats;
        if (typeof inbound.packetsLost === "number") packetsLost += inbound.packetsLost;
      }
    });
    const qualityStatsRef = JSON.stringify({
      rttMs: roundTripTimeMs,
      packetsLost,
    }).slice(0, 500);
    return { connectionType, qualityStatsRef };
  } catch {
    return null;
  }
}

/** FR-366: shared by a real user-initiated hangup and the real duration-limit enforcement. */
async function endActiveCall(reason: "COMPLETED" | "DURATION_LIMIT_REACHED" | "COMPLETED_LOCAL_FAILURE"): Promise<void> {
  const state = useCallStore.getState();
  if (!state.callSessionId || !state.matchId) return;
  const report = await computeEndReport();
  emitCallHangup({ callSessionId: state.callSessionId, reason });
  try {
    await endCall(state.matchId, state.callSessionId, {
      ...(report ?? {}),
      ...(reason === "DURATION_LIMIT_REACHED" ? { endReason: "DURATION_LIMIT_REACHED" as const } : {}),
    });
  } catch {
    // Fail-open: the real hangup already happened locally and was relayed
    // over the socket — a failed REST report must never re-open the call.
  }
  teardownConnection();
  useCallStore.getState().setPhase("ended");
}

/** FR-361: the real, always-reachable hangup control. */
export function hangup(): void {
  void endActiveCall("COMPLETED");
}

/** Returns to idle after a real "ended" state has been shown. */
export function dismissEndedCall(): void {
  useCallStore.getState().reset();
}
