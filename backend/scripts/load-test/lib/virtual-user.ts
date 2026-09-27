import sharp from 'sharp';
import { io, Socket } from 'socket.io-client';
import { recordOpenAiCall } from './openai-cost-guard';

/**
 * One simulated real user driving the real, running HTTP API (and, for
 * chat, the real WebSocket namespace) — no in-process app, no mocked
 * providers; this hits whatever backend is actually listening at `baseUrl`,
 * matching every other real-infrastructure test in this project. Request
 * shapes mirror backend/test/chat.e2e-spec.ts's own getAccessToken/
 * buildVerifiedProfile/createMatch helpers exactly (read directly from the
 * real code, not guessed).
 */

let phoneCounter = 0;
const runId = Date.now().toString().slice(-7);

/**
 * Same shape/reasoning as test/helpers/unique-phone.ts — a fresh, real,
 * never-reused phone per virtual user. A real bug was found and fixed here
 * during this tool's very first smoke-test run, not anticipated in the
 * initial draft: the original version prepended a "+1556" marker prefix
 * then `.slice(0, 16)`'d the result to fit the real E.164 validation
 * pattern's max length — but that truncation silently cut off the *last*
 * two digits of the zero-padded sequence number, the only part meant to
 * distinguish concurrent users. Every group of 10 virtual users created in
 * the same run (seq 0-9, 10-19, ...) collided onto the identical truncated
 * phone number, causing exactly the "OTP verify: 401 Invalid or expired
 * code" failure this collision produces — the second user's real OTP
 * request for the same real phone number invalidated the first user's
 * already-captured code. Fixed by dropping the cosmetic marker prefix
 * entirely and mirroring unique-phone.ts's own proven, untruncated scheme
 * instead of inventing a variant of it.
 */
export function uniqueLoadTestPhone(): string {
  const seq = (phoneCounter++).toString().padStart(6, '0');
  return `+1${runId}${seq}`;
}

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

async function apiCall<T = unknown>(
  baseUrl: string,
  method: string,
  path: string,
  options: { token?: string; json?: unknown; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form; // fetch sets the multipart boundary itself
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as T) : (undefined as T);
  return { status: res.status, body: parsed };
}

export class VirtualUser {
  readonly phone: string;
  token = '';
  userId = '';
  private socket: Socket | null = null;

  /** `phoneOverride` — used by scripts/seed-test-users.ts, which wants its
   * own recognizable, re-loginable phone scheme rather than the load-test
   * harness's own transient-and-cleaned-up one. Defaults to
   * `uniqueLoadTestPhone()` (unchanged) for every existing load-test
   * scenario. */
  constructor(
    private readonly baseUrl: string,
    phoneOverride?: string,
  ) {
    this.phone = phoneOverride ?? uniqueLoadTestPhone();
  }

  /** Real OTP request+verify — reads the real devCode off the real
   * response (AUTH_OTP_DEBUG_ECHO=true, the same real, existing test-only
   * mechanism this project's whole e2e suite already depends on for
   * exactly this reason). Never a mock provider override — this is a real,
   * already-running server, not an in-process TestingModule. */
  async signUp(): Promise<void> {
    const requestRes = await apiCall<{ devCode?: string }>(
      this.baseUrl,
      'POST',
      '/v1/auth/otp/request',
      { json: { phone: this.phone } },
    );
    if (!requestRes.body.devCode) {
      // Real bug found in a real run: this used to always say "is
      // AUTH_OTP_DEBUG_ECHO on?", which is misleading when the real cause
      // is something else entirely (a real 503/429/network failure whose
      // body just has no devCode field) — masking the actual signal a load
      // test exists to surface. Now includes the real status and body.
      throw new Error(
        `No devCode in /v1/auth/otp/request response (status ${requestRes.status}, body ${JSON.stringify(requestRes.body)}) — ` +
          'either the target backend is not running with AUTH_OTP_DEBUG_ECHO=true, or this is a real failure (rate limit, transient DB error, etc.).',
      );
    }
    const verifyRes = await apiCall<{
      accessToken: string;
      user: { id: string };
    }>(this.baseUrl, 'POST', '/v1/auth/otp/verify', {
      json: { phone: this.phone, code: requestRes.body.devCode },
    });
    if (verifyRes.status !== 200) {
      throw new Error(
        `OTP verify failed: ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`,
      );
    }
    this.token = verifyRes.body.accessToken;
    this.userId = verifyRes.body.user.id;
  }

  /** Shared by completeProfile() and completeProfileDetailed() — a real,
   * tiny, valid JPEG uploaded through the real endpoint (real moderation
   * call, Feature 8). Extracted so scripts/seed-test-users.ts's own more
   * flexible profile-completion method doesn't duplicate this. */
  private async uploadPlaceholderPhoto(): Promise<void> {
    const jpeg = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: { r: 10, g: 10, b: 10 },
      },
    })
      .jpeg()
      .toBuffer();
    const form = new FormData();
    form.append(
      'photo',
      new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }),
      'p.jpg',
    );
    const photoRes = await apiCall(this.baseUrl, 'POST', '/v1/profile/photos', {
      token: this.token,
      form,
    });
    recordOpenAiCall('photo upload (image moderation)');
    if (photoRes.status !== 201) {
      throw new Error(
        `POST /v1/profile/photos failed: ${photoRes.status} ${JSON.stringify(photoRes.body)}`,
      );
    }
  }

  /** Real profile + real photo (real moderation call, Feature 8) + real
   * liveness auto-pass (MockLivenessProvider, unchanged from every e2e
   * run — the liveness *vendor* itself is mocked everywhere in this
   * project's dev/test tier, not something this tool changes). */
  async completeProfile(displayName: string): Promise<void> {
    const profileRes = await apiCall(this.baseUrl, 'PATCH', '/v1/profile', {
      token: this.token,
      json: {
        displayName,
        birthDate: '1994-01-01',
        gender: 'MALE',
        datingIntent: 'SERIOUS',
      },
    });
    recordOpenAiCall('profile write (bio/displayName moderation)');
    if (profileRes.status !== 200) {
      throw new Error(
        `PATCH /v1/profile failed: ${profileRes.status} ${JSON.stringify(profileRes.body)}`,
      );
    }

    await this.uploadPlaceholderPhoto();

    const consentRes = await apiCall(
      this.baseUrl,
      'POST',
      '/v1/consent/biometric',
      {
        token: this.token,
        json: { policyVersion: 'v1' },
      },
    );
    if (consentRes.status !== 201) {
      throw new Error(
        `POST /v1/consent/biometric failed: ${consentRes.status}`,
      );
    }
    const livenessRes = await apiCall(
      this.baseUrl,
      'POST',
      '/v1/verification/liveness/session',
      {
        token: this.token,
      },
    );
    if (livenessRes.status !== 201) {
      throw new Error(
        `POST /v1/verification/liveness/session failed: ${livenessRes.status}`,
      );
    }
  }

  /**
   * Used by scripts/seed-test-users.ts — full control over every real,
   * meaningful profile field (unlike completeProfile()'s fixed values),
   * and an explicit `verify` flag: `false` skips the real consent+liveness
   * calls entirely, leaving `livenessStatus` at its real default (`false`)
   * — the only real way to produce an unverified seeded user, since
   * MockLivenessProvider always passes once a session is actually started.
   */
  async completeProfileDetailed(input: {
    displayName: string;
    birthDate: string;
    gender: 'MALE' | 'FEMALE' | 'OTHER';
    datingIntent:
      'SERIOUS' | 'CASUAL' | 'MARRIAGE_TRACK' | 'FRIENDSHIP' | 'NOT_SURE';
    city: string;
    bio: string;
    interests: string[];
    verify: boolean;
  }): Promise<void> {
    const profileRes = await apiCall(this.baseUrl, 'PATCH', '/v1/profile', {
      token: this.token,
      json: {
        displayName: input.displayName,
        birthDate: input.birthDate,
        gender: input.gender,
        datingIntent: input.datingIntent,
        city: input.city,
        bio: input.bio,
        interests: input.interests,
      },
    });
    recordOpenAiCall('profile write (bio/displayName moderation)');
    if (profileRes.status !== 200) {
      throw new Error(
        `PATCH /v1/profile failed: ${profileRes.status} ${JSON.stringify(profileRes.body)}`,
      );
    }

    await this.uploadPlaceholderPhoto();

    if (!input.verify) return;

    const consentRes = await apiCall(
      this.baseUrl,
      'POST',
      '/v1/consent/biometric',
      {
        token: this.token,
        json: { policyVersion: 'v1' },
      },
    );
    if (consentRes.status !== 201) {
      throw new Error(
        `POST /v1/consent/biometric failed: ${consentRes.status}`,
      );
    }
    const livenessRes = await apiCall(
      this.baseUrl,
      'POST',
      '/v1/verification/liveness/session',
      {
        token: this.token,
      },
    );
    if (livenessRes.status !== 201) {
      throw new Error(
        `POST /v1/verification/liveness/session failed: ${livenessRes.status}`,
      );
    }
  }

  fetchDeck(): Promise<ApiResult<{ candidates: { id: string }[] }>> {
    return apiCall(this.baseUrl, 'GET', '/v1/discovery/deck?limit=20', {
      token: this.token,
    });
  }

  swipe(
    targetUserId: string,
    action: 'PASS' | 'LIKE' | 'SUPER_LIKE',
  ): Promise<ApiResult<{ matched: boolean; matchId?: string }>> {
    return apiCall(this.baseUrl, 'POST', '/v1/discovery/swipes', {
      token: this.token,
      json: { targetUserId, action },
    });
  }

  /** Real lazy match-explanation generation can fire on first read of a
   * match with no explanation yet — biased toward over-counting (§
   * openai-cost-guard.ts), so every call here is recorded as a real
   * OpenAI-touching call even though not every individual call actually
   * triggers generation. */
  getMatches(): Promise<ApiResult<unknown[]>> {
    recordOpenAiCall(
      'GET /discovery/matches (possible lazy explanation generation)',
    );
    return apiCall(this.baseUrl, 'GET', '/v1/discovery/matches', {
      token: this.token,
    });
  }

  getConversations(): Promise<ApiResult<unknown[]>> {
    return apiCall(this.baseUrl, 'GET', '/v1/chat/conversations', {
      token: this.token,
    });
  }

  sendMessage(
    matchId: string,
    content: string,
  ): Promise<ApiResult<{ id: string }>> {
    recordOpenAiCall('message send (text moderation)');
    return apiCall(
      this.baseUrl,
      'POST',
      `/v1/chat/conversations/${matchId}/messages`,
      {
        token: this.token,
        json: { content, clientIdempotencyKey: crypto.randomUUID() },
      },
    );
  }

  connectChatSocket(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(`${this.baseUrl}/chat`, {
        auth: { token: this.token },
        transports: ['websocket'],
      });
      socket.on('connect', () => {
        this.socket = socket;
        resolve(socket);
      });
      socket.on('connect_error', (err) => reject(err));
    });
  }

  disconnectChatSocket(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  getSettings(): Promise<ApiResult<unknown>> {
    return apiCall(this.baseUrl, 'GET', '/v1/users/me/settings', {
      token: this.token,
    });
  }

  updatePrivacy(input: Record<string, unknown>): Promise<ApiResult<unknown>> {
    return apiCall(this.baseUrl, 'PATCH', '/v1/users/me/privacy', {
      token: this.token,
      json: input,
    });
  }

  /** Real extraction + real embedding-backed ranking — two real OpenAI
   * round-trips per call (Feature 9), both recorded. */
  /**
   * A real bug was found and fixed here during Tier 2's first real run: the
   * real `POST /v1/discovery/ai-search/extract` response is
   * `{ filters: {...} }` — a nested object (`ExtractedFiltersResponseDto`,
   * `ai-search.controller.ts`), not the flat filter fields directly at the
   * top level. The original code spread the whole response wrapper
   * (`{...extractRes.body, ...}`) into the search request, which added an
   * unrecognized `filters` key instead of the real filter fields
   * themselves — rejected by the real `ValidationPipe`'s
   * `forbidNonWhitelisted: true`, producing a real 400 on every single
   * call (50/50 across all three Tier 2 stages, confirmed directly from
   * the run's own metrics, not assumed). Fixed by unwrapping `.filters`
   * before spreading.
   */
  async aiSearch(text: string): Promise<ApiResult<unknown>> {
    recordOpenAiCall('ai-search extract (gpt-4o-mini)');
    const extractRes = await apiCall<{ filters: Record<string, unknown> }>(
      this.baseUrl,
      'POST',
      '/v1/discovery/ai-search/extract',
      { token: this.token, json: { text } },
    );
    recordOpenAiCall('ai-search search (embedding + ranking)');
    return apiCall(this.baseUrl, 'POST', '/v1/discovery/ai-search', {
      token: this.token,
      json: { ...extractRes.body.filters, mode: 'TEXT', semanticQuery: text },
    });
  }

  /** Real, complete account deletion — needs its own fresh OTP
   * re-verification (Feature 6 FR-83), exactly like a real user would.
   * Used by cleanup.ts, not by scenario bodies directly. */
  async deleteAccount(): Promise<void> {
    const requestRes = await apiCall<{ devCode?: string }>(
      this.baseUrl,
      'POST',
      '/v1/auth/otp/request',
      { json: { phone: this.phone } },
    );
    if (!requestRes.body.devCode) {
      throw new Error('No devCode for deletion re-verification.');
    }
    const res = await apiCall(this.baseUrl, 'DELETE', '/v1/users/me', {
      token: this.token,
      json: { phone: this.phone, code: requestRes.body.devCode },
    });
    if (res.status !== 204) {
      throw new Error(
        `Account deletion failed for ${this.phone}: ${res.status}`,
      );
    }
  }
}
