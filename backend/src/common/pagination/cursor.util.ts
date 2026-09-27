import { BadRequestException } from '@nestjs/common';

export interface KeysetCursor {
  sortKey: Date;
  id: string;
}

/**
 * Shared keyset-pagination cursor, `(sortKey, id)`, used by every
 * cursor-paginated endpoint in this codebase (product.md §8.2) — the deck
 * (Feature 3, ascending by createdAt) and chat history (Feature 4,
 * descending by sentAt) both encode/decode through this same pair.
 */
export function encodeCursor(sortKey: Date, id: string): string {
  return Buffer.from(`${sortKey.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): KeysetCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid cursor.');
  }

  const [iso, id] = decoded.split('|');
  const sortKey = iso ? new Date(iso) : undefined;

  if (!id || !sortKey || Number.isNaN(sortKey.getTime())) {
    throw new BadRequestException('Invalid cursor.');
  }

  return { sortKey, id };
}

export interface RankedCursor {
  /** Cosine distance (nullable — un-embedded candidates sort last, FR-112). */
  distance: number | null;
  sortKey: Date;
  id: string;
}

/**
 * A `(distance, sortKey, id)` keyset cursor for a ranked, non-monotonic
 * result set (Feature 9, FR-113 — semantic-similarity search) — extends
 * this same shared utility rather than a second, parallel one. `distance`
 * is nullable because un-embedded candidates are never excluded (FR-112);
 * `sortKey` (createdAt) breaks ties among them, and `id` remains the final
 * tiebreaker for the same reason the plain `(sortKey, id)` cursor needs one.
 */
export function encodeRankedCursor(
  distance: number | null,
  sortKey: Date,
  id: string,
): string {
  const distancePart = distance === null ? 'null' : distance.toString();
  return Buffer.from(
    `${distancePart}|${sortKey.toISOString()}|${id}`,
    'utf8',
  ).toString('base64url');
}

export function decodeRankedCursor(cursor: string): RankedCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid cursor.');
  }

  const [distancePart, iso, id] = decoded.split('|');
  const sortKey = iso ? new Date(iso) : undefined;
  const distance = distancePart === 'null' ? null : Number(distancePart);

  if (
    !id ||
    !sortKey ||
    Number.isNaN(sortKey.getTime()) ||
    distancePart === undefined ||
    (distance !== null && Number.isNaN(distance))
  ) {
    throw new BadRequestException('Invalid cursor.');
  }

  return { distance, sortKey, id };
}
