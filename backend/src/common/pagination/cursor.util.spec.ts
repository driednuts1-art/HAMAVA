import { BadRequestException } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  decodeRankedCursor,
  encodeRankedCursor,
} from './cursor.util';

describe('cursor.util', () => {
  it('round-trips sortKey and id through encode/decode', () => {
    const sortKey = new Date('2026-01-15T10:30:00.000Z');
    const id = 'abc-123';
    const decoded = decodeCursor(encodeCursor(sortKey, id));
    expect(decoded.sortKey.toISOString()).toBe(sortKey.toISOString());
    expect(decoded.id).toBe(id);
  });

  it('rejects a garbage cursor', () => {
    expect(() => decodeCursor('not-a-valid-cursor-at-all')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a cursor missing the id half', () => {
    const malformed = Buffer.from('2026-01-15T10:30:00.000Z', 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCursor(malformed)).toThrow(BadRequestException);
  });
});

describe('cursor.util — ranked (Feature 9, FR-113)', () => {
  it('round-trips a real numeric distance, sortKey, and id', () => {
    const sortKey = new Date('2026-01-15T10:30:00.000Z');
    const decoded = decodeRankedCursor(
      encodeRankedCursor(0.1234, sortKey, 'user-1'),
    );
    expect(decoded.distance).toBe(0.1234);
    expect(decoded.sortKey.toISOString()).toBe(sortKey.toISOString());
    expect(decoded.id).toBe('user-1');
  });

  it('round-trips a null distance (FR-112: un-embedded candidates are never excluded)', () => {
    const sortKey = new Date('2026-01-15T10:30:00.000Z');
    const decoded = decodeRankedCursor(
      encodeRankedCursor(null, sortKey, 'user-2'),
    );
    expect(decoded.distance).toBeNull();
    expect(decoded.id).toBe('user-2');
  });

  it('round-trips a distance of exactly 0 (must not be confused with null/falsy)', () => {
    const sortKey = new Date('2026-01-15T10:30:00.000Z');
    const decoded = decodeRankedCursor(
      encodeRankedCursor(0, sortKey, 'user-3'),
    );
    expect(decoded.distance).toBe(0);
  });

  it('rejects a garbage ranked cursor', () => {
    expect(() => decodeRankedCursor('not-a-valid-cursor')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a ranked cursor with a non-numeric, non-"null" distance field', () => {
    const malformed = Buffer.from(
      'not-a-number|2026-01-15T10:30:00.000Z|user-1',
      'utf8',
    ).toString('base64url');
    expect(() => decodeRankedCursor(malformed)).toThrow(BadRequestException);
  });
});
