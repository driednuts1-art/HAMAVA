// FR-317: a client-only "has the signature match-moment animation already
// played for this match" gate — there is no backend concept of a match
// being "seen" (only messages have readAt). A plain array of match UUIDs,
// never treated as a security boundary (docs/requirements.md Feature 17 §8).
const STORAGE_KEY = "hamava:seen-matches";

function readSeenSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function hasSeenMatch(matchId: string): boolean {
  return readSeenSet().has(matchId);
}

export function markMatchSeen(matchId: string): void {
  if (typeof window === "undefined") return;
  const seen = readSeenSet();
  seen.add(matchId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
}
