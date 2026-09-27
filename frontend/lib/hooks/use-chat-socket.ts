import { useEffect, useSyncExternalStore } from "react";
import {
  connectChatSocket,
  disconnectChatSocket,
  getChatConnectionStatus,
  onChatMessage,
  onChatStatusChange,
  type ChatConnectionStatus,
} from "@/lib/websocket-client";
import type { Message } from "@/lib/queries/chat";
import { useAuthStore } from "@/lib/auth-store";
import { initCallListening } from "@/lib/webrtc";

/** FR-330/332: connects once for the authenticated session, disconnects on logout. */
export function useChatConnection(): void {
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === "authenticated") {
      connectChatSocket();
      return () => disconnectChatSocket();
    }
    return undefined;
  }, [status]);
}

/** FR-345: the global call:incoming listener — mounted once, app-wide,
 * alongside useChatConnection() (same authenticated-session gate), so an
 * incoming call is caught from any tab, not just an open conversation. */
export function useCallListening(): void {
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === "authenticated") initCallListening();
  }, [status]);
}

/** FR-333: real, minimal connection-status affordance. */
export function useChatConnectionStatus(): ChatConnectionStatus {
  return useSyncExternalStore(
    onChatStatusChange,
    getChatConnectionStatus,
    () => "disconnected" as const,
  );
}

/** FR-324/325: filters the app-wide socket's push events down to one match. */
export function useLiveMessages(
  matchId: string,
  onMessage: (message: Message) => void,
): void {
  useEffect(() => {
    return onChatMessage((message) => {
      if (message.matchId === matchId) onMessage(message);
    });
    // onMessage is expected to be stable (useCallback at the call site) —
    // re-subscribing on every render would be real, avoidable churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);
}
