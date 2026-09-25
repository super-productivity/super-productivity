/**
 * Applies migration 20260828000003 to a REAL PostgreSQL and asserts the catalog
 * afterwards.
 *
 * Why this file exists: CI builds its database with `prisma db push`
 * (`.github/workflows/supersync-server-tests.yml`), which never applies
 * migrations at all. So `tests/migration-sql.spec.ts` — the only other coverage
 * this migration has — asserts the reloption as TEXT in a file. It cannot tell
 * you the statement parses, that PostgreSQL accepts these option names, or that
 * the catalog ends up holding what the migration says it holds. Everything here
 * is a claim the text test structurally cannot make.
 *
 * It reads the migration from disk rather than restating the SQL, so the two
 * cannot drift: if someone edits the migration, this runs the edited version.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const currentDir = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  join(
    currentDir,
    '../../prisma/migrations/20260828000003_tune_operations_autovacuum/migration.sql',
  ),
  'utf8',
);

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL ?? '' } } });

const reloptionsFor = async (relname: string): Promise<string[] | null> => {
  const rows = await prisma.$queryRawUnsafe<Array<{ reloptions: string[] | null }>>(
    `SELECT reloptions FROM pg_class WHERE relname = '${relname}'`,
  );
  return rows[0]?.reloptions ?? null;
};

const RESET_ALL = `ALTER TABLE "operations" RESET (autovacuum_vacuum_scale_factor,
   autovacuum_vacuum_insert_scale_factor, autovacuum_analyze_scale_factor)`;

describeWithDb('operations autovacuum reloptions (real PostgreSQL)', () => {
  /**
   * CI builds with `prisma db push` and starts from no reloptions, but a
   * developer may point DATABASE_URL at a database that has actually had this
   * migration applied. Restoring what was there beats a blanket RESET, which
   * would silently strip the tuning from their database.
   */
  let originalReloptions: string[] | null = null;

  beforeAll(async () => {
    originalReloptions = await reloptionsFor('operations');
    // Start from the shipped default so a leftover setting cannot make this pass.
    await prisma.$executeRawUnsafe(RESET_ALL);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(RESET_ALL);
    if (originalReloptions?.length) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "operations" SET (${originalReloptions.join(', ')})`,
      );
    }
    await prisma.$disconnect();
  });

  it('runs on a server at or above the declared PostgreSQL 16 floor', async () => {
    // The migration sets autovacuum_vacuum_insert_scale_factor, which does not
    // exist before PG13 and fails the whole ALTER with 22023 — an error
    // migrate-deploy.sh has no gate for, so the chain would stay blocked on
    // every later deploy. README.md declares 16 as the supported floor; this
    // asserts the box the rest of the file's claims were verified on.
    const [{ server_version_num }] = await prisma.$queryRawUnsafe<
      Array<{ server_version_num: string }>
    >(`SELECT current_setting('server_version_num') AS server_version_num`);

    expect(Number(server_version_num)).toBeGreaterThanOrEqual(160_000);
  });

  it('applies, and leaves exactly the insert factor in the catalog', async () => {
    expect(await reloptionsFor('operations')).toBeNull();

    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    // Sorted so the assertion does not depend on catalog ordering.
    const reloptions = [...((await reloptionsFor('operations')) ?? [])].sort();
    expect(reloptions).toEqual(['autovacuum_vacuum_insert_scale_factor=0.02']);
    // The two omissions are the decision, so assert them against the CATALOG
    // and not just against the file. ANALYZE samples a fixed 30,000 random
    // blocks that no page-skipping reduces; and an insert-triggered vacuum
    // reports `index scans: 0` where a post-DELETE one walks all 8 indexes, so
    // lowering the dead-tuple factor is what would cost real I/O here. See the
    // migration's rationale.
    expect(reloptions.join(',')).not.toContain('analyze');
    expect(reloptions.join(',')).not.toContain('autovacuum_vacuum_scale_factor');
  });

  it('is idempotent on re-run', async () => {
    // migrate-deploy.sh's documented recovery for a 57014 collision with an
    // anti-wraparound vacuum is `migrate resolve --rolled-back` and re-run, so
    // re-application has to be safe rather than merely likely to be.
    const before = await reloptionsFor('operations');
    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    expect(await reloptionsFor('operations')).toEqual(before);
  });

  it("leaves the TOAST relation's own reloptions NULL despite inheriting them", async () => {
    // The trap the migration warns about, pinned so nobody "fixes" the NULL by
    // setting a toast.autovacuum_* option: that would give the TOAST relation
    // its own reloptions, and the parent-value fallback is all-or-nothing, so
    // one explicit option silently drops the inheritance for every other field.
    const [{ toast_name }] = await prisma.$queryRawUnsafe<
      Array<{ toast_name: string }>
    >(`SELECT t.relname AS toast_name
         FROM pg_class c JOIN pg_class t ON t.oid = c.reltoastrelid
         WHERE c.relname = 'operations'`);

    expect(await reloptionsFor(toast_name)).toBeNull();
  });
});
