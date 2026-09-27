// Runs once per e2e test file, before any imports in that file (including
// @nestjs/config's dotenv load) — dotenv never overrides a var already
// present in process.env, so this wins over .env's OTP_RATE_LIMIT_BYPASS=false
// without editing that shared file. See docs/roadmap.md and
// src/modules/auth/otp/otp.service.ts for why this bypass exists.
process.env.OTP_RATE_LIMIT_BYPASS = 'true';
