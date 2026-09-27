// Shared React Query keys for Feature 17's chat/match data — kept in one
// place so the tab bar's unread badge (components/layout/tab-bar.tsx) and
// the match list screen (components/matches/match-list.tsx) invalidate and
// refetch the exact same cache entry (FR-309, FR-316), never two
// independent copies that can silently drift out of sync.

export const CONVERSATIONS_QUERY_KEY = ["chat", "conversations"];
export const MATCHES_QUERY_KEY = ["discovery", "matches"];

export function messageHistoryQueryKey(matchId: string) {
  return ["chat", "messages", matchId];
}
