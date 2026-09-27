// Decoded (never verified — meaningless client-side without the JWT secret,
// and unnecessary since these are UI-scheduling/routing concerns, not
// security checks; docs/requirements.md Feature 14 FR-208).
export interface DecodedAccessToken {
  sub: string;
  exp: number;
}

export function decodeAccessToken(token: string): DecodedAccessToken | null {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(normalized);
    const decoded = JSON.parse(json) as Partial<DecodedAccessToken>;
    if (typeof decoded.sub !== "string" || typeof decoded.exp !== "number") {
      return null;
    }
    return { sub: decoded.sub, exp: decoded.exp };
  } catch {
    return null;
  }
}
