import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  // Pooled endpoint — the app's own runtime connection (docs/architecture.md §5.1).
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  // Direct (unpooled) endpoint — prisma.config.ts uses this for CLI/migrate
  // commands only; the app itself never reads this env var.
  @IsString()
  @IsNotEmpty()
  DIRECT_URL!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRES_IN!: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_EXPIRES_IN!: string;

  @IsString()
  @IsNotEmpty()
  PHONE_HASH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  OTP_CODE_HASH_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  REFRESH_TOKEN_HASH_SECRET!: string;

  @IsInt()
  @Min(30)
  OTP_TTL_SECONDS!: number;

  @IsInt()
  @Min(1)
  OTP_MAX_ATTEMPTS!: number;

  @IsInt()
  @Min(1)
  OTP_REQUEST_LIMIT_PER_PHONE_PER_HOUR!: number;

  @IsInt()
  @Min(1)
  OTP_REQUEST_LIMIT_PER_IP_PER_HOUR!: number;

  // Test-only bypass for the OTP rate limiter (docs/roadmap.md "known
  // infrastructure debt") — must be "false" in .env; e2e runs override it via
  // test/jest-e2e.setup.ts, and ProductionSafetyService refuses to boot if
  // this is "true" under NODE_ENV=production.
  @IsIn(['true', 'false'])
  OTP_RATE_LIMIT_BYPASS!: string;

  @IsInt()
  @Min(1)
  LIVENESS_SESSION_LIMIT_PER_HOUR!: number;

  @IsString()
  @IsNotEmpty()
  PRIVACY_POLICY_VERSION!: string;

  @IsInt()
  @Min(1)
  PROFILE_MAX_PHOTOS!: number;

  @IsInt()
  @Min(1)
  PROFILE_MAX_UPLOAD_BYTES!: number;

  // Feature 7: real S3-compatible object storage (docs/requirements.md FR-90)
  // — replaces PHOTO_STORAGE_DIR (the retired local-disk mock's folder) entirely.
  // Works unchanged against any S3-compatible endpoint — only these values
  // change between MinIO (dev/test) and a real vendor (production).
  @IsString()
  @IsNotEmpty()
  STORAGE_ENDPOINT!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_REGION!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_BUCKET!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_SECRET_ACCESS_KEY!: string;

  // 'true' for MinIO and most non-AWS S3-compatible vendors (path-style
  // bucket addressing); 'false' for real AWS S3 (virtual-hosted-style).
  @IsIn(['true', 'false'])
  STORAGE_FORCE_PATH_STYLE!: string;

  // FR-89: presigned URL lifetime — never a permanent public link.
  @IsInt()
  @Min(60)
  PHOTO_URL_EXPIRY_SECONDS!: number;

  @IsString()
  @IsNotEmpty()
  CLAMD_HOST!: string;

  @IsInt()
  @Min(1)
  CLAMD_PORT!: number;

  @IsInt()
  @Min(1)
  CLAMD_TIMEOUT_MS!: number;

  @IsInt()
  @Min(1)
  SWIPE_RATE_LIMIT_PER_MINUTE!: number;

  @IsInt()
  @Min(1)
  MESSAGE_RATE_LIMIT_PER_MINUTE!: number;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  // Feature 8: real content moderation (docs/requirements.md FR-96) — OpenAI
  // Moderation API, omni-moderation-latest, used for both text and image.
  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY!: string;

  @IsInt()
  @Min(1)
  MODERATION_TIMEOUT_MS!: number;

  // Feature 9 (docs/requirements.md FR-115): independent, configurable
  // per-minute rate limits — voice defaults materially lower than text since
  // Whisper is billed separately from the extraction/embedding calls.
  @IsInt()
  @Min(1)
  AI_SEARCH_TEXT_RATE_LIMIT_PER_MINUTE!: number;

  @IsInt()
  @Min(1)
  AI_SEARCH_VOICE_RATE_LIMIT_PER_MINUTE!: number;

  // FR-107: a deliberate file-size proxy for the 30-45s duration cap, not an
  // exact decoded-duration measurement (docs/requirements.md Feature 9, Open
  // Items #4) — a generous ceiling for a reasonably-compressed short clip.
  @IsInt()
  @Min(1)
  AI_SEARCH_MAX_AUDIO_BYTES!: number;

  // FR-116: fetch timeout for the extraction/embedding calls, same
  // fail-closed-on-timeout pattern as MODERATION_TIMEOUT_MS.
  @IsInt()
  @Min(1)
  AI_SEARCH_TIMEOUT_MS!: number;

  // Shared transcription provider (common/ai/) — used by both Feature 9
  // (voice search) and Feature 11 (voice turns), so it gets its own timeout
  // config independent of AI_SEARCH_TIMEOUT_MS above.
  @IsInt()
  @Min(1)
  AI_TRANSCRIPTION_TIMEOUT_MS!: number;

  // Feature 10: Super Like explanation / "Why You Two?" / Smart Boost.
  @IsInt()
  @Min(1)
  MATCH_EXPLANATION_TIMEOUT_MS!: number;

  // FR-126: Open Items #4 — a placeholder, not data-driven.
  @IsInt()
  @Min(1)
  BOOST_DURATION_MINUTES!: number;

  // FR-130: rate limit on boost activation.
  @IsInt()
  @Min(1)
  BOOST_RATE_LIMIT_PER_DAY!: number;

  // Feature 11: Conversational (text+voice) Profile Setup.
  // FR-134: session inactivity TTL, refreshed on every turn.
  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_SESSION_TTL_MINUTES!: number;

  // Open Items #6: a concrete ceiling, not "however long it takes."
  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_MAX_TURNS!: number;

  // FR-138/FR-139: fetch timeout for the extraction+next-question call.
  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_TIMEOUT_MS!: number;

  // FR-148: independent rolling-window limits for session starts and each
  // turn type (mirrors Feature 9 FR-115's text/voice split).
  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_SESSION_START_RATE_LIMIT_PER_HOUR!: number;

  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_TEXT_TURN_RATE_LIMIT_PER_MINUTE!: number;

  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_VOICE_TURN_RATE_LIMIT_PER_MINUTE!: number;

  // FR-137: mirrors AI_SEARCH_MAX_AUDIO_BYTES's exact file-size-as-duration-proxy approach.
  @IsInt()
  @Min(1)
  CONVERSATIONAL_SETUP_MAX_AUDIO_BYTES!: number;

  // Feature 12: Share My Date.
  // FR-159: CryptoService.hashShareToken()'s dedicated HMAC secret — never
  // reused from REFRESH_TOKEN_HASH_SECRET, so a compromise of one hash key
  // doesn't affect the other.
  @IsString()
  @IsNotEmpty()
  DATE_SHARE_TOKEN_HASH_SECRET!: string;

  // FR-157: anchored to the date's own `datetime`, not to creation time —
  // Open Items #2, decided at 24.
  @IsInt()
  @Min(1)
  DATE_SHARE_LINK_BUFFER_HOURS!: number;

  // FR-168: per-user creation rate limit — Open Items #4, a placeholder.
  @IsInt()
  @Min(1)
  DATE_SHARE_LINK_RATE_LIMIT_PER_DAY!: number;

  // FR-169: per-IP lookup rate limit on the public, unauthenticated endpoint
  // — Open Items #4, a placeholder.
  @IsInt()
  @Min(1)
  DATE_SHARE_LOOKUP_RATE_LIMIT_PER_IP_PER_MINUTE!: number;

  // Feature 13: Voice/Video Calling — Cloudflare Realtime TURN.
  @IsString()
  @IsNotEmpty()
  CLOUDFLARE_TURN_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  CLOUDFLARE_TURN_API_TOKEN!: string;

  // FR-175: a single, uniform TTL for every call (Open Items #1) — long
  // enough to comfortably outlast any real call, short enough to remain a
  // real, hard-to-replay credential rather than the vendor's own default.
  @IsInt()
  @Min(1)
  CLOUDFLARE_TURN_CREDENTIAL_TTL_SECONDS!: number;

  // FR-190: Open Items #2 — a placeholder, not data-driven.
  @IsInt()
  @Min(1)
  FIRST_CALL_DURATION_LIMIT_SECONDS!: number;

  // FR-181: Open Items #4 — how long a RINGING call may sit unanswered
  // before being lazily treated as MISSED.
  @IsInt()
  @Min(1)
  CALL_RINGING_TIMEOUT_SECONDS!: number;

  // FR-196: call-start rate limit, independent of MESSAGE_RATE_LIMIT_PER_MINUTE.
  @IsInt()
  @Min(1)
  CALL_START_RATE_LIMIT_PER_HOUR!: number;

  // Real gap closed (2026-09-18 audit): reports had no dedicated rate limit
  // at all — this is independent of every other rate limit in the app.
  @IsInt()
  @Min(1)
  REPORT_RATE_LIMIT_PER_HOUR!: number;

  // Feature 14 (frontend): FR-205 — the one browser origin allowed to call
  // this API directly (never a wildcard).
  @IsString()
  @IsNotEmpty()
  FRONTEND_ORIGIN!: string;

  // Feature 14 FR-223, Open Items #3 — test-only escape hatch mirroring
  // OTP_RATE_LIMIT_BYPASS exactly: refused in production by
  // ProductionSafetyService regardless of this value, and even here only
  // takes effect when OTP_PROVIDER is genuinely the mock (otp.service.ts).
  @IsIn(['true', 'false'])
  AUTH_OTP_DEBUG_ECHO!: string;

  // Feature 21 (FR-300/301): feature kill switches — default "true" (§5:
  // must never silently disable a real capability by omission).
  @IsIn(['true', 'false'])
  AI_SEARCH_ENABLED!: string;

  @IsIn(['true', 'false'])
  AI_ONBOARDING_ENABLED!: string;

  @IsIn(['true', 'false'])
  VOICE_CALLS_ENABLED!: string;

  @IsIn(['true', 'false'])
  VIDEO_CALLS_ENABLED!: string;

  @IsIn(['true', 'false'])
  PUBLIC_SAFETY_SHARE_ENABLED!: string;
}

/** Fails fast at boot if required config is missing/malformed, instead of at first request. */
export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.toString()}`);
  }

  return validated;
}
