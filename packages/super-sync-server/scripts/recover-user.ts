/**
 * recover-user.ts — operator data-recovery tool for SuperSync accounts.
 *
 * Reconstructs a user's full app state (`AppDataComplete`) as of a chosen
 * server sequence by replaying their operation log — the SAME replay the
 * server's `generateSnapshotAtSeq` uses, but it ALSO decrypts E2E-encrypted op
 * payloads, which the server-side restore endpoint refuses to do. Use when a
 * bad SYNC_IMPORT wiped an account: replay up to the seq just before the wipe.
 *
 * Read-only on the database. Run with `--help` for usage. The encryption key is
 * read only from RECOVER_ENCRYPT_KEY / --key-file, never a CLI arg. The output
 * file holds the user's COMPLETE plaintext data — transmit it securely and
 * delete every copy once recovery is confirmed. The script logs only sequence
 * numbers, timestamps and entity-type counts — never task content, never the key.
 *
 * Status: UNVERIFIED against real encrypted data — test against a known account
 * first. See docs/backup-and-recovery.md for the full procedure.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { prisma, disconnectDb } from '../src/db';
import { replayOpsToState, type ReplayOperationRow } from '../src/sync/op-replay';

// sync-core lives in a sibling package. Loaded via require() so the server's
// `tsc` build (rootDir = this package) never tries to compile its source;
// ts-node --transpile-only resolves and transpiles the .ts on demand at runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { decryptBatch } = require('../../sync-core/src/encryption') as {
  decryptBatch: (items: string[], password: string) => Promise<string[]>;
};

const FULL_STATE_OP_TYPES = ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'];

interface Args {
  user?: string;
  inspect: boolean;
  targetSeq?: number;
  out?: string;
  keyFile?: string;
  dryRun: boolean;
}

const USAGE = `
recover-user — reconstruct a SuperSync user's state from the operation log

  Inspect (find the cutoff sequence, no key needed):
    npm run recover-user -- --user <email|id> --inspect

  Recover (replay up to the cutoff, write an importable JSON file):
    RECOVER_ENCRYPT_KEY='<passphrase>' \\
      npm run recover-user -- --user <email|id> --target-seq <N> --out ./recovered.json

  Options:
    --user <email|id>   Target user (required).
    --inspect           List full-state ops + sequence range, then exit.
    --target-seq <N>    Replay operations up to and including this server seq.
    --out <path>        Where to write the recovered AppDataComplete JSON.
    --key-file <path>   Read the encryption key from a file instead of the env var.
    --dry-run           Replay and print a summary, but write nothing.

  The encryption key comes from RECOVER_ENCRYPT_KEY or --key-file — never a flag.
`;

const parseArgs = (argv: string[]): Args => {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }
  const args: Args = { inspect: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--user':
        args.user = argv[++i];
        break;
      case '--inspect':
        args.inspect = true;
        break;
      case '--target-seq':
        args.targetSeq = Number(argv[++i]);
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--key-file':
        args.keyFile = argv[++i];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (args.targetSeq !== undefined && !Number.isInteger(args.targetSeq)) {
    throw new Error('--target-seq must be an integer');
  }
  return args;
};

const readKey = (keyFile?: string): string | undefined => {
  if (keyFile) {
    const fromFile = readFileSync(keyFile, 'utf8').trim();
    return fromFile.length > 0 ? fromFile : undefined;
  }
  const env = process.env.RECOVER_ENCRYPT_KEY;
  return env && env.length > 0 ? env : undefined;
};

const resolveUserId = async (userArg: string): Promise<number> => {
  const asId = Number(userArg);
  if (Number.isInteger(asId) && asId > 0) {
    const byId = await prisma.user.findUnique({
      where: { id: asId },
      select: { id: true },
    });
    if (byId) return byId.id;
  }
  const byEmail = await prisma.user.findUnique({
    where: { email: userArg },
    select: { id: true },
  });
  if (byEmail) return byEmail.id;
  throw new Error(`No user found for "${userArg}" (tried both id and email).`);
};

const inspect = async (userId: number): Promise<void> => {
  const syncState = await prisma.userSyncState.findUnique({ where: { userId } });
  const total = await prisma.operation.count({ where: { userId } });
  const encrypted = await prisma.operation.count({
    where: { userId, isPayloadEncrypted: true },
  });
  const fullStateOps = await prisma.operation.findMany({
    where: { userId, opType: { in: FULL_STATE_OP_TYPES } },
    orderBy: { serverSeq: 'asc' },
    select: {
      serverSeq: true,
      opType: true,
      clientId: true,
      syncImportReason: true,
      isPayloadEncrypted: true,
      clientTimestamp: true,
      receivedAt: true,
    },
  });

  console.log(`\nUser ${userId}`);
  console.log(`  lastSeq (server):   ${syncState?.lastSeq ?? '(no sync state row)'}`);
  console.log(`  total operations:   ${total}`);
  console.log(`  encrypted payloads: ${encrypted} / ${total}`);
  console.log(`\nFull-state operations (restore points / wipe events):`);
  if (fullStateOps.length === 0) {
    console.log('  (none)');
  }
  for (const op of fullStateOps) {
    const received = new Date(Number(op.receivedAt)).toISOString();
    const client = new Date(Number(op.clientTimestamp)).toISOString();
    console.log(
      `  seq ${String(op.serverSeq).padStart(8)}  ${op.opType.padEnd(13)}` +
        `  received ${received}  client ${client}` +
        `  enc=${op.isPayloadEncrypted ? 'Y' : 'N'}` +
        (op.syncImportReason ? `  reason=${op.syncImportReason}` : ''),
    );
  }
  console.log(
    `\nNext: pick the bad import above, then replay up to (its seq - 1):\n` +
      `  RECOVER_ENCRYPT_KEY='<passphrase>' npm run recover-user -- ` +
      `--user ${userId} --target-seq <seq-1> --out ./recovered.json\n`,
  );
};

/** Decrypt the encrypted ops in place, returning a seq-indexed payload map. */
const decryptPayloads = async (
  ops: { id: string; isPayloadEncrypted: boolean; payload: unknown }[],
  key: string,
): Promise<Map<number, unknown>> => {
  const encryptedIndexes: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].isPayloadEncrypted) encryptedIndexes.push(i);
  }
  const decrypted = new Map<number, unknown>();
  if (encryptedIndexes.length === 0) return decrypted;

  const ciphertexts = encryptedIndexes.map((i) => {
    const payload = ops[i].payload;
    if (typeof payload !== 'string') {
      throw new Error(
        `Op ${ops[i].id} is flagged encrypted but its payload is not a string.`,
      );
    }
    return payload;
  });

  console.log(
    `Decrypting ${ciphertexts.length} encrypted payloads ` +
      `(Argon2id key derivation — this can take a while)...`,
  );
  let plaintexts: string[];
  try {
    plaintexts = await decryptBatch(ciphertexts, key);
  } catch (e) {
    throw new Error(
      'Decryption failed — the encryption key is almost certainly incorrect. ' +
        `(${(e as Error).message})`,
    );
  }
  encryptedIndexes.forEach((opIndex, j) => {
    try {
      decrypted.set(opIndex, JSON.parse(plaintexts[j]));
    } catch {
      throw new Error(
        `Decrypted payload for op ${ops[opIndex].id} is not valid JSON ` +
          `(unexpected — possible key mismatch or data corruption).`,
      );
    }
  });
  return decrypted;
};

const recover = async (
  userId: number,
  targetSeq: number,
  key: string | undefined,
  outPath: string | undefined,
  dryRun: boolean,
): Promise<void> => {
  const syncState = await prisma.userSyncState.findUnique({ where: { userId } });
  const lastSeq = syncState?.lastSeq ?? 0;
  if (targetSeq < 1) throw new Error('--target-seq must be >= 1');
  if (targetSeq > lastSeq) {
    throw new Error(`--target-seq ${targetSeq} exceeds the user's lastSeq ${lastSeq}`);
  }

  const ops = await prisma.operation.findMany({
    where: { userId, serverSeq: { lte: targetSeq } },
    orderBy: { serverSeq: 'asc' },
    select: {
      id: true,
      serverSeq: true,
      opType: true,
      entityType: true,
      entityId: true,
      payload: true,
      schemaVersion: true,
      isPayloadEncrypted: true,
    },
  });
  if (ops.length === 0) {
    throw new Error('No operations found at or below the target sequence.');
  }

  // Contiguity: a mid-stream gap means lost data. A leading gap (log not
  // starting at seq 1) is only safe if the first op is a full-state op, since
  // replay resets state on those — mirrors op-replay's _resolveExpectedFirstSeq.
  const first = ops[0];
  if (first.serverSeq !== 1 && !FULL_STATE_OP_TYPES.includes(first.opType)) {
    throw new Error(
      `Operation log starts at seq ${first.serverSeq} (not 1) and that op is ` +
        `'${first.opType}', not a full-state op — cannot reconstruct a complete state.`,
    );
  }
  for (let i = 1; i < ops.length; i++) {
    if (ops[i].serverSeq !== ops[i - 1].serverSeq + 1) {
      throw new Error(
        `Gap in operation log: seq ${ops[i - 1].serverSeq} -> ${ops[i].serverSeq}. ` +
          `Operations are missing; recovery would be incomplete.`,
      );
    }
  }

  const encryptedCount = ops.filter((o) => o.isPayloadEncrypted).length;
  if (encryptedCount > 0 && !key) {
    throw new Error(
      `${encryptedCount} of ${ops.length} operations are encrypted, but no ` +
        `encryption key was provided. Set RECOVER_ENCRYPT_KEY or pass --key-file.`,
    );
  }
  const decryptedByIndex =
    encryptedCount > 0 && key ? await decryptPayloads(ops, key) : new Map();

  const rows: ReplayOperationRow[] = ops.map((op, i) => ({
    id: op.id,
    serverSeq: op.serverSeq,
    opType: op.opType,
    entityType: op.entityType,
    entityId: op.entityId,
    payload: decryptedByIndex.has(i) ? decryptedByIndex.get(i) : op.payload,
    schemaVersion: op.schemaVersion,
    // Payloads are plaintext at this point — replay rejects encrypted rows.
    isPayloadEncrypted: false,
  }));

  const state = replayOpsToState(rows);

  console.log(
    `\nReconstructed state at seq ${targetSeq} ` +
      `(replayed ${rows.length} ops, ${encryptedCount} decrypted):`,
  );
  for (const [entityType, value] of Object.entries(state)) {
    if (value && typeof value === 'object') {
      const map = value as Record<string, unknown>;
      const count = Array.isArray(map.ids) ? map.ids.length : Object.keys(map).length;
      console.log(`  ${entityType.padEnd(26)} ~${count}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written. Re-run with --out to save the file.');
    return;
  }
  if (!outPath) {
    throw new Error('--out <path> is required (or use --dry-run to preview).');
  }
  writeFileSync(outPath, JSON.stringify(state, null, 2), 'utf8');
  console.log(`\nWrote recovered state to ${outPath}`);
  console.log(
    "This file contains the user's COMPLETE plaintext data. Transmit it over a\n" +
      'secure channel and delete every copy once recovery is confirmed.\n' +
      'The user imports it via Settings -> Import/Export -> Import from File.',
  );
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.user) {
    console.error('Missing --user <email|id>.');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const userId = await resolveUserId(args.user);

  if (args.inspect) {
    await inspect(userId);
    return;
  }
  if (args.targetSeq === undefined) {
    console.error('Missing --target-seq <N>. Run with --inspect first to find it.');
    process.exitCode = 1;
    return;
  }
  await recover(userId, args.targetSeq, readKey(args.keyFile), args.out, args.dryRun);
};

main()
  .catch((e) => {
    console.error(`\nERROR: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
