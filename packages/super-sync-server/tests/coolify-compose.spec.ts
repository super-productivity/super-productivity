import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

const compose = (): string =>
  readFileSync(join(currentDir, '../docker-compose.coolify.yml'), 'utf8');

/**
 * The file with whole-line comments removed.
 *
 * Structural assertions run against this: the compose explains its own reasoning
 * at length, so a bare `not.toContain('caddy')` would match the comment that says
 * Coolify replaces Caddy and fail on correct config.
 */
const config = (): string =>
  compose()
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

/** The body of one top-level service block, comments included. */
const service = (name: string): string => {
  const file = compose();
  const start = file.search(new RegExp(`^ {2}${name}:$`, 'm'));
  if (start === -1) {
    throw new Error(`service ${name} not found`);
  }
  const rest = file.slice(start);
  const next = rest.slice(1).search(/^ {2}\S+:$/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

/**
 * Invariants of the Coolify deployment compose.
 *
 * Coolify does not run this file as-is: it parses it, injects an .env, attaches
 * every service to its own network and terminates TLS with its own proxy. Each
 * assertion below pins one decision that would otherwise rot silently — the
 * stack still comes up, it just comes up wrong (or not at all) on the platform
 * this file exists for. The plain-compose equivalent was verified by bringing the
 * stack up; these guard the parts a local run cannot prove.
 */
describe('coolify deployment compose', () => {
  it('leaves container naming, host ports and networking to the platform', () => {
    const file = config();

    // Coolify names and labels containers itself; a pinned name also collides
    // across two resources on one host.
    expect(file).not.toMatch(/^\s*container_name:/m);
    // A published port binds the host, is unreachable by Coolify's proxy (which
    // talks over its own Docker network) and squats a port on the machine.
    expect(file).not.toMatch(/^\s*ports:/m);
    // Declaring a network with a pinned `name:` collides the same way.
    expect(file).not.toMatch(/^networks:/m);
    // Coolify replaces Caddy. Keeping it would mean two proxies fighting over
    // :80/:443 and two TLS terminators.
    expect(file).not.toMatch(/^\s{2}caddy:/m);
    expect(file).not.toContain('Caddyfile');
    // Obsolete in Compose v2 and ignored.
    expect(file).not.toMatch(/^version:/m);
  });

  it('sources secrets from Coolify magic variables rather than bare names', () => {
    const file = compose();

    // A bare JWT_SECRET/POSTGRES_PASSWORD is not a SERVICE_* name, so Coolify
    // creates nothing for it, interpolates it empty, and the stack refuses to
    // boot (auth.ts requires a 32+ char secret; postgres refuses to initdb).
    expect(file).toContain('JWT_SECRET=${SERVICE_PASSWORD_64_SUPERSYNC}');
    expect(file).toContain('POSTGRES_PASSWORD=${SERVICE_PASSWORD_POSTGRES}');
    // The connection string must interpolate the SAME generated value, or the
    // URL and the database disagree and the server crash-loops with 28P01 while
    // postgres itself stays healthy.
    expect(file).toMatch(
      /DATABASE_URL=postgresql:\/\/\$\{POSTGRES_USER:-supersync\}:\$\{SERVICE_PASSWORD_POSTGRES\}@/,
    );
    // Passwords with symbols would emit `@ : / ? # &` and corrupt that URL.
    expect(file).not.toContain('SERVICE_PASSWORDWITHSYMBOLS');
    // A typo'd magic command is created empty and deploys happily.
    expect(file).not.toContain('SERVICE_BASE64');
  });

  it('derives self-referential URLs from the assigned FQDN', () => {
    const file = compose();

    // config.ts hard-fails boot when PUBLIC_URL is not https under
    // NODE_ENV=production, so the shipped http://localhost default is fatal.
    expect(file).toContain('PUBLIC_URL=${SERVICE_URL_SUPERSYNC_1900}');
    expect(file).not.toContain('PUBLIC_URL=${PUBLIC_URL:-http://');
    // Passkeys bind to the RP ID; a hardcoded localhost silently breaks them on
    // the real domain.
    expect(file).toContain('WEBAUTHN_RP_ID=${SERVICE_FQDN_SUPERSYNC}');
    expect(file).toContain('WEBAUTHN_ORIGIN=${SERVICE_URL_SUPERSYNC_1900}');
    // With no `ports:` anywhere, `expose` is the only declaration of the
    // container port Coolify's proxy routes to.
    expect(file).toMatch(/^\s*expose:\n\s*- '1900'$/m);
  });

  it('fails fast on the one value Coolify cannot generate', () => {
    const file = compose();

    // CORS_ORIGINS must be the app's origin; the shipped default only allows
    // https://app.super-productivity.com. Without this the app loads and then
    // every save fails with an opaque network error.
    expect(file).toContain('CORS_ORIGINS=${CORS_ORIGINS:?set this to the app');
  });

  it('runs migrations in-container, since Coolify never runs deploy.sh', () => {
    const file = compose();

    expect(file).toContain(
      'RUN_MIGRATIONS_ON_STARTUP=${RUN_MIGRATIONS_ON_STARTUP:-true}',
    );
    // `compose` selects a recovery path that shells out to `docker compose run`
    // on the HOST — no Docker CLI or socket inside a Coolify container, so a
    // failed migration would have no recovery path at all. migrate-deploy.sh
    // treats unset and empty identically, so the variable is left out entirely
    // rather than set to an empty string.
    expect(config()).not.toMatch(/^\s*- MIGRATE_RECOVERY_RUNTIME=/m);
    expect(file).not.toContain('MIGRATE_RECOVERY_RUNTIME=compose');
    // The pool bounds are required or REQUIRE_DATABASE_POOL_LIMITS rejects the URL.
    expect(file).toContain('REQUIRE_DATABASE_POOL_LIMITS=true');
    expect(file).toContain('connection_limit=60&pool_timeout=10');
  });

  it('keeps the host-level hardening the production compose depends on', () => {
    // dockerd SIGKILLs a probe that outlives `timeout`, orphaning pg_isready
    // into the postmaster; it then exits 2 and the postmaster treats that as a
    // backend crash, restarting the whole cluster. (#9695)
    expect(service('postgres')).toMatch(/^ {4}init: true$/m);
    expect(service('supersync')).toMatch(/^ {4}init: true$/m);
    // The supersync image is node:24-alpine with `apk add wget`; it has no curl,
    // so a probe using one always fails. Scoped to this service because the app
    // image is nginx:1 on Debian and genuinely does ship curl.
    expect(service('supersync')).toContain("'wget'");
    expect(service('supersync')).not.toContain("'curl'");
  });

  it('persists both stateful volumes', () => {
    const file = compose();

    expect(file).toContain('supersync-data:/app/data');
    expect(file).toContain('postgres-data:/var/lib/postgresql/data');
    // Guards against a volume being declared but not actually mounted.
    expect(file.match(/^volumes:$/m)).toHaveLength(1);
  });
});
