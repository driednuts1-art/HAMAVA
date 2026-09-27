import 'dotenv/config';
import { defineConfig, env } from '@prisma/config';

// Prisma 7 moved connection info out of schema.prisma. This file supplies it
// for CLI commands (migrate, studio, ...); the app itself passes a driver
// adapter directly to PrismaClient — see src/prisma/prisma.service.ts.
//
// Deliberately DIRECT_URL, not DATABASE_URL: DATABASE_URL is Neon's pooled
// (PgBouncer) endpoint as of docs/roadmap.md's connection-pooling switch —
// safe for the app's own query traffic, but migrate/introspection use
// session-scoped advisory locks and DDL that aren't reliable under
// transaction-mode pooling. This config's own `Datasource` type has no
// `directUrl` field (unlike classic schema.prisma), so the split is achieved
// by pointing the CLI and the app runtime at two different env vars instead.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DIRECT_URL'),
  },
});
