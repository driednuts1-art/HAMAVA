import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { createClient } from 'redis';
import { connect } from 'net';

/**
 * Runs exactly once, before any e2e test file executes (Jest's
 * `globalSetup`, not `setupFiles` — this one is per-run, not per-file).
 *
 * Found the hard way, three times independently across this project's life
 * (Feature 8, then again during Feature 21's verification, `docs/roadmap.md`
 * "Known infrastructure debt"): MinIO and `clamd` are local dev-only
 * processes with no supervisor, so they don't survive a machine/session
 * restart, and nothing detects that they've silently died. Every request
 * that reaches a dead one fails closed with a real 503 (or, for MinIO
 * specifically, a genuinely misleading `InvalidAccessKeyId` if it dies
 * mid-request) — which looks exactly like a real code regression until
 * someone manually runs `netstat`/`Get-Process` to rule it out, costing
 * real debugging time each time.
 *
 * This check buys back that time by failing the whole e2e run immediately,
 * before a single real request is made, with one unambiguous line per dead
 * dependency — instead of a wall of confusing test failures 10+ minutes
 * into a run.
 */

const CHECK_TIMEOUT_MS = 5000;

async function withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS}ms`)),
      CHECK_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function checkMinio(): Promise<void> {
  const endpoint = process.env.STORAGE_ENDPOINT;
  if (!endpoint) throw new Error('STORAGE_ENDPOINT is not set in .env');
  const res = await fetch(`${endpoint}/minio/health/live`);
  if (!res.ok) throw new Error(`health endpoint returned ${res.status}`);
}

async function checkClamd(): Promise<void> {
  const host = process.env.CLAMD_HOST;
  const port = Number(process.env.CLAMD_PORT);
  if (!host || !port) {
    throw new Error('CLAMD_HOST/CLAMD_PORT are not set in .env');
  }
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port }, () => socket.write('PING\n'));
    socket.on('data', (data) => {
      socket.end();
      if (data.toString().trim() === 'PONG') resolve();
      else reject(new Error(`unexpected reply: ${data.toString().trim()}`));
    });
    socket.on('error', reject);
  });
}

async function checkPostgres(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set in .env');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    await client.end();
  }
}

async function checkRedis(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set in .env');
  const client = createClient({ url });
  client.on('error', () => {
    // Swallowed deliberately: the ping/connect call below already surfaces
    // the failure to this function's caller — without this handler, the
    // client's own internal error emission would crash the process before
    // that happens.
  });
  await client.connect();
  try {
    await client.ping();
  } finally {
    await client.quit();
  }
}

export default async function globalSetup(): Promise<void> {
  loadEnv({ path: `${__dirname}/../.env` });

  const checks: { name: string; run: () => Promise<void> }[] = [
    { name: 'MinIO', run: checkMinio },
    { name: 'clamd', run: checkClamd },
    { name: 'Postgres (Neon)', run: checkPostgres },
    { name: 'Redis', run: checkRedis },
  ];

  const results = await Promise.allSettled(
    checks.map((c) => withTimeout(c.name, c.run())),
  );

  const failures = results
    .map((result, i) => ({ name: checks[i].name, result }))
    .filter(
      (r): r is { name: string; result: PromiseRejectedResult } =>
        r.result.status === 'rejected',
    );

  if (failures.length > 0) {
    const lines = failures.map(
      (f) => `  - ${f.name} is not reachable: ${f.result.reason.message}`,
    );
    throw new Error(
      `\n\ne2e pre-flight check failed — ${failures.length} real ` +
        `dependenc${failures.length === 1 ? 'y is' : 'ies are'} not ` +
        `reachable, before any test ran:\n${lines.join('\n')}\n\n` +
        `Start the missing service(s) and re-run. This check exists so a ` +
        `dead local dependency is never mistaken for a real code ` +
        `regression again — see docs/roadmap.md's "Known infrastructure ` +
        `debt" section.\n`,
    );
  }
}
