import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecipheriv, createECDH, ECDH } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import {
  captureAad,
  deriveCaptureKey,
  SEAL_HEADER_BYTES,
  SEAL_VERSION,
} from '../src/capture/capture-seal';

/**
 * PGlite stand-in for the Prisma client the capture stores use: raw SQL,
 * transactions, and the user reads and writes of `verifyToken` and
 * `revokeAllTokens`. The
 * capture tables come from the shipped migration, not a copy.
 */

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations/20261011000000_add_capture_tables/migration.sql',
);

export const createCaptureSchema = async (db: PGlite): Promise<void> => {
  await db.exec(`
    DROP TABLE IF EXISTS capture_auth, capture_connect_codes, capture_items, capture_grants, capture_keys, users;
    CREATE TABLE users (
      id serial PRIMARY KEY,
      email text NOT NULL UNIQUE,
      is_verified integer NOT NULL DEFAULT 1,
      token_version integer NOT NULL DEFAULT 0
    );`);
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(
    readFileSync(
      join(dirname(MIGRATION), '../20261012000000_capture_oauth/migration.sql'),
      'utf8',
    ),
  );
};

export const addUser = async (db: PGlite, email: string): Promise<number> => {
  const rows = await db.query<{ id: number }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email],
  );
  return rows.rows[0].id;
};

const toSql = (
  first: TemplateStringsArray | Prisma.Sql,
  rest: Array<Prisma.Sql | Prisma.Sql['values'][number]>,
): Prisma.Sql =>
  Array.isArray(first)
    ? Prisma.sql(first as TemplateStringsArray, ...rest)
    : (first as Prisma.Sql);

export const createCapturePrisma = (db: PGlite): Record<string, unknown> => {
  type RawArgs = [TemplateStringsArray | Prisma.Sql, ...Array<Prisma.Sql | unknown>];
  const client: Record<string, unknown> = {
    $queryRaw: async (...[first, ...rest]: RawArgs) => {
      const sql = toSql(first, rest as Prisma.Sql['values']);
      return (await db.query(sql.text, sql.values)).rows;
    },
    $executeRaw: async (...[first, ...rest]: RawArgs) => {
      const sql = toSql(first, rest as Prisma.Sql['values']);
      return (await db.query(sql.text, sql.values)).affectedRows ?? 0;
    },
    user: {
      findUnique: async (args: { where: { id: number } }) => {
        const rows = await db.query<Record<string, number>>(
          `SELECT id, token_version AS "tokenVersion", is_verified AS "isVerified"
           FROM users WHERE id = $1`,
          [args.where.id],
        );
        return rows.rows[0] ?? null;
      },
      // Only the tokenVersion bump revokeAllTokens makes.
      update: async (args: {
        where: { id: number };
        data: { tokenVersion: { increment: number } };
      }) => {
        await db.query(
          'UPDATE users SET token_version = token_version + $2 WHERE id = $1',
          [args.where.id, args.data.tokenVersion.increment],
        );
        return {};
      },
    },
  };
  // PGlite is one connection: transactions run one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  client['$transaction'] = (fn: (tx: unknown) => Promise<unknown>) => {
    const run = queue.then(async () => {
      await db.exec('BEGIN');
      try {
        const result = await fn(client);
        await db.exec('COMMIT');
        return result;
      } catch (err) {
        await db.exec('ROLLBACK');
        throw err;
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
  return client;
};

const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);

/** A fresh P-256 key; `publicKey` is what the app registers, base64 SPKI DER. */
export const newCaptureKeyPair = (): { ecdh: ECDH; publicKey: string } => {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const spki = Buffer.concat([P256_SPKI_PREFIX, ecdh.getPublicKey()]);
  return { ecdh, publicKey: spki.toString('base64') };
};

/** The open side, as the app implements it. Throws on any tampering. */
export const openCapture = (user: ECDH, itemId: string, sealed: string): unknown => {
  const bytes = Buffer.from(sealed, 'base64');
  if (bytes[0] !== SEAL_VERSION) throw new Error('Unknown seal version');
  const ephemeralPoint = bytes.subarray(1, 66);
  const iv = bytes.subarray(66, SEAL_HEADER_BYTES);
  const body = bytes.subarray(SEAL_HEADER_BYTES);
  if (body.length < 16) throw new Error('Truncated');
  const key = deriveCaptureKey(
    user.computeSecret(ephemeralPoint),
    ephemeralPoint,
    user.getPublicKey(),
  );
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(captureAad(itemId));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([
    decipher.update(body.subarray(0, body.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
};
