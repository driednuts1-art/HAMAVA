import { io, type Socket } from "socket.io-client";
import { useAuthStore } from "./auth-store";
import { refreshAccessTokenOnce } from "./session-refresh";
import type { Message } from "./queries/chat";
import type { CallType } from "./queries/calls";

// FR-330..333: one connection, app-wide, opened once from the tab-bar
// layout (components/layout/tab-bar.tsx's provider), not per-conversation.
// Mirrors backend/src/modules/chat/chat.gateway.ts exactly: namespace
// `/chat`, auth via `auth.token` (the same in-memory access token every
// REST call already uses, FR-206), push-only for chat — there is no
// client->server send event for messages, sending stays REST-only
// (lib/queries/chat.ts::sendMessage).
//
// Feature 18 (FR-343, FR-352): the same namespace also carries real call
// signaling — chat.gateway.ts's first-ever client->server events. Unlike
// chat, this genuinely needs an outbound emit path (call:signal/hangup),
// which nothing in this module exposed before.

const SOCKET_PATH = "/chat";

export type ChatConnectionStatus = "disconnected" | "connecting" | "connected";

type StatusListener = (status: ChatConnectionStatus) => void;
type MessageListener = (message: Message) => void;

// Mirrors backend/src/modules/chat/chat.gateway.ts's real payload shapes
// exactly (verified by reading the real code) — docs/requirements.md
// Feature 18 §1.
export interface CallIncomingPayload {
  callSessionId: string;
  matchId: string;
  type: CallType;
  fromUserId: string;
}
export interface CallLimitReachedPayload {
  callSessionId: string;
}
export interface CallSignalPayload {
  callSessionId: string;
  fromUserId: string;
  payload: unknown;
}
export interface CallHangupPayload {
  callSessionId: string;
  reason: string;
}

type CallIncomingListener = (payload: CallIncomingPayload) => void;
type CallLimitReachedListener = (payload: CallLimitReachedPayload) => void;
type CallSignalListener = (payload: CallSignalPayload) => void;
type CallHangupListener = (payload: CallHangupPayload) => void;

// Feature 27 (FR-480): 20s under the backend's 45s presence TTL
// (backend/src/modules/presence/presence.service.ts) — tolerates up to two
// missed beats before genuinely going offline.
const PRESENCE_HEARTBEAT_INTERVAL_MS = 20_000;

let socket: Socket | null = null;
let status: ChatConnectionStatus = "disconnected";
let refreshAttempted = false;
let presenceHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

const statusListeners = new Set<StatusListener>();
const messageListeners = new Set<MessageListener>();
const callIncomingListeners = new Set<CallIncomingListener>();
const callLimitReachedListeners = new Set<CallLimitReachedListener>();
const callSignalListeners = new Set<CallSignalListener>();
const callHangupListeners = new Set<CallHangupListener>();

function setStatus(next: ChatConnectionStatus): void {
  status = next;
  statusListeners.forEach((listener) => listener(next));
}

export function getChatConnectionStatus(): ChatConnectionStatus {
  return status;
}

/** FR-330: opened once per authenticated session. A second call while
 * already connected/connecting is a no-op. */
export function connectChatSocket(): void {
  if (socket) return;

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not set.");
  }

  setStatus("connecting");
  refreshAttempted = false;

  socket = io(`${apiBaseUrl}${SOCKET_PATH}`, {
    // FR-330: a function, not a captured value — re-evaluated on every
    // (re)connection attempt, so a reconnect after Feature 14's own FR-208
    // proactive refresh already rotated the token picks up the new one
    // automatically, with no reconnect-specific logic needed here.
    auth: (callback) => {
      callback({ token: useAuthStore.getState().accessToken });
    },
  });

  socket.on("connect", () => {
    refreshAttempted = false;
    setStatus("connected");
    // Feature 27 (FR-480): keeps the backend's presence:online TTL alive
    // for as long as this one, app-wide connection (FR-330) stays open.
    if (presenceHeartbeatTimer) clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = setInterval(() => {
      socket?.emit("presence:heartbeat");
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  });

  // FR-331, corrected after a real bug found running Feature 17's own e2e
  // suite under sustained heavy load: `connect_error` fires for genuine
  // transport/network failures (the exact class the earlier CORS bug
  // surfaced as) — it is NOT where an auth rejection shows up. The
  // gateway's own auth check (chat.gateway.ts::handleConnection) runs
  // *after* the low-level connection already succeeded, and rejects it by
  // calling `socket.disconnect(true)` — which the client sees as a real
  // `disconnect` event with reason `"io server disconnect"`, never
  // `connect_error`. The original code refreshed the token on *every*
  // `connect_error`, including ones with nothing to do with auth (a
  // transiently overloaded dev server under this project's own
  // well-documented "heavy combined real-vendor load" pattern) — under
  // exactly that load, repeated unnecessary refresh calls raced the
  // refresh token's real single-use rotation and killed the session
  // (a real, reproduced `POST /api/auth/refresh` 401 pair, confirmed via
  // the backend/frontend logs, not assumed). Fixed by refreshing only on
  // the one disconnect reason that actually means "the server rejected
  // this token," and letting a plain transport hiccup fall through to
  // socket.io's own default automatic reconnection (which re-reads the
  // current token fresh via the `auth` callback above on every retry, so
  // no manual intervention is needed for that case at all).
  socket.on("disconnect", (reason) => {
    setStatus("disconnected");
    if (presenceHeartbeatTimer) {
      clearInterval(presenceHeartbeatTimer);
      presenceHeartbeatTimer = null;
    }
    if (reason !== "io server disconnect" || refreshAttempted) return;
    refreshAttempted = true;
    void refreshAccessTokenOnce().then((token) => {
      if (token) socket?.connect();
    });
  });

  socket.on("message:new", (message: Message) => {
    messageListeners.forEach((listener) => listener(message));
  });

  socket.on("call:incoming", (payload: CallIncomingPayload) => {
    callIncomingListeners.forEach((listener) => listener(payload));
  });
  socket.on("call:limit-reached", (payload: CallLimitReachedPayload) => {
    callLimitReachedListeners.forEach((listener) => listener(payload));
  });
  socket.on("call:signal", (payload: CallSignalPayload) => {
    callSignalListeners.forEach((listener) => listener(payload));
  });
  socket.on("call:hangup", (payload: CallHangupPayload) => {
    callHangupListeners.forEach((listener) => listener(payload));
  });
}

/** FR-332: never left open against a cleared session. */
export function disconnectChatSocket(): void {
  socket?.disconnect();
  socket = null;
  setStatus("disconnected");
  if (presenceHeartbeatTimer) {
    clearInterval(presenceHeartbeatTimer);
    presenceHeartbeatTimer = null;
  }
}

export function onChatStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function onChatMessage(listener: MessageListener): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

export function onCallIncoming(listener: CallIncomingListener): () => void {
  callIncomingListeners.add(listener);
  return () => callIncomingListeners.delete(listener);
}

export function onCallLimitReached(listener: CallLimitReachedListener): () => void {
  callLimitReachedListeners.add(listener);
  return () => callLimitReachedListeners.delete(listener);
}

export function onCallSignal(listener: CallSignalListener): () => void {
  callSignalListeners.add(listener);
  return () => callSignalListeners.delete(listener);
}

export function onCallHangup(listener: CallHangupListener): () => void {
  callHangupListeners.add(listener);
  return () => callHangupListeners.delete(listener);
}

// FR-352: the one genuinely new capability this module needed for calls —
// everything above this point in the file (chat included) is push-only.
// Silently does nothing if the socket isn't connected (mirrors this
// project's existing "fail open on a transient signaling gap" posture for
// WebSocket pushes — chat.gateway.ts's own message:new push is
// best-effort too); the call UI's own connection-status affordance
// (FR-362) is what surfaces a disconnected state to the user, not this.
export function emitCallSignal(payload: {
  callSessionId: string;
  toUserId: string;
  payload: unknown;
}): void {
  socket?.emit("call:signal", payload);
}

export function emitCallHangup(payload: {
  callSessionId: string;
  reason?: string;
}): void {
  socket?.emit("call:hangup", payload);
}
