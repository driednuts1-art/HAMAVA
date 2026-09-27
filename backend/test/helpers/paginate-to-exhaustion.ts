import request from 'supertest';
import { App } from 'supertest/types';

/**
 * This project's real dev/test database is never reset between e2e runs
 * (per this codebase's own "never mock the backend, verify for real"
 * standard — every e2e suite runs against real Postgres, not a fixture
 * snapshot), so it only ever grows: 73 complete-profile users when this
 * class of bug was first found and fixed (Feature 10's Smart Boost tests,
 * `docs/architecture.md` §5.15), 93 by the time it independently recurred
 * in three more files during Feature 21's verification pass
 * (`discovery.e2e-spec.ts`, `report-block.e2e-spec.ts`,
 * `ai-search.e2e-spec.ts`'s ranking test) — all four failures were the
 * exact same mechanism: a single unpaginated page (`GET
 * /v1/discovery/deck?limit=50` or a `POST /v1/discovery/ai-search` with no
 * `cursor`) assumed a just-created test candidate would be somewhere in it,
 * which stops being true once `DeckService`'s own `(createdAt ASC)`
 * ordering (oldest first) pushes a brand-new candidate past that single
 * page among enough real historical users.
 *
 * Centralized here instead of re-fixing each file separately, so the next
 * e2e file that needs to find a specific candidate in the deck or search
 * results starts from a call that is robust to the database's real,
 * ever-growing size instead of quietly repeating the same assumption.
 * Pages via each endpoint's own real cursor mechanism to exhaustion — never
 * assumes a bounded historical pool size, because none is actually
 * guaranteed.
 */

interface PagedCandidate {
  id: string;
}

interface PagedResponseBody<T> {
  candidates: T[];
  nextCursor: string | null;
}

const MAX_PAGES = 50;

export async function fetchFullDeck<T extends PagedCandidate = PagedCandidate>(
  server: App,
  token: string,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (
      await request(server)
        .get(`/v1/discovery/deck?limit=50${cursor ? `&cursor=${cursor}` : ''}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as PagedResponseBody<T>;
    all.push(...res.candidates);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return all;
}

export async function fetchFullSearch<
  T extends PagedCandidate = PagedCandidate,
>(server: App, token: string, body: Record<string, unknown>): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (
      await request(server)
        .post('/v1/discovery/ai-search')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...body, limit: 50, ...(cursor ? { cursor } : {}) })
        .expect(201)
    ).body as PagedResponseBody<T>;
    all.push(...res.candidates);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return all;
}
