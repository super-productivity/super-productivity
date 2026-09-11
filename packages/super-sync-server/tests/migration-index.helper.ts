import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
);

/**
 * The shipped `CREATE INDEX` for one index, READ OUT OF ITS MIGRATION rather than copied
 * into a spec. Copying the predicate would make a plan guard's whole claim conditional on
 * a comment asking future authors to keep two places in step: the specs measure what
 * ships only for as long as the copy is accurate, and a drifted copy fails silently by
 * measuring a world that does not exist. Extracting it means a migration whose shape
 * changes makes the spec throw — loudly, at setup — instead.
 *
 * `CONCURRENTLY` is stripped: it cannot run inside a transaction and buys nothing here.
 */
export const createIndexFromMigration = (
  migrationDir: string,
  indexName: string,
): string => {
  const sql = readFileSync(join(migrationsDir, migrationDir, 'migration.sql'), 'utf8');
  const statement = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`CREATE INDEX CONCURRENTLY "${indexName}"`));
  if (!statement) {
    throw new Error(
      `no CREATE INDEX CONCURRENTLY "${indexName}" found in ${migrationDir}/migration.sql`,
    );
  }
  return statement.replace(' CONCURRENTLY', '');
};
