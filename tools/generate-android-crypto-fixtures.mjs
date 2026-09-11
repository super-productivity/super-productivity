#!/usr/bin/env node
/**
 * Generates live encryption fixtures for the Android crypto unit tests.
 *
 * The Android background sync re-implements Argon2id + AES-GCM op-payload
 * decryption in Kotlin (android .../crypto/OpPayloadDecryptor.kt). Its tests
 * pin frozen ciphertexts, which only prove compatibility with sync-core as of
 * the day they were generated. This script encrypts fresh fixtures with the
 * REAL sync-core encrypt() so CI fails on the PR that changes the KDF
 * parameters or wire format, instead of background reminders silently
 * degrading (consumed by LiveJsEncryptRoundTripTest.kt).
 *
 * Usage: node tools/generate-android-crypto-fixtures.mjs [outFile]
 * Requires packages/sync-core to be built (happens on `npm i` via prepare).
 *
 * Output is TSV with base64-wrapped fields so the Kotlin side needs no JSON
 * parser and no quoting rules:
 *   password\t<base64 utf-8 password>
 *   entry\t<name>\t<base64 utf-8 plaintext>\t<ciphertext, already base64>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { clearSessionKeyCache, encrypt } from '../packages/sync-core/dist/index.mjs';

// Non-ASCII on purpose: proves both sides encode the password as UTF-8
const PASSWORD = 'live-fixture-pässword-🔑';

const ENTRIES = [
  [
    'crt-op',
    '{"actionPayload":{},"entityChanges":[{"entityType":"TASK",' +
      '"entityId":"task-crt-1","opType":"CRT","changes":{' +
      '"id":"task-crt-1","title":"Water plants",' +
      '"remindAt":4102444500000,"deadlineRemindAt":4102444700000}}]}',
  ],
  [
    'unicode-payload',
    '{"actionPayload":{"task":{"id":"t1","title":"Müsli 🥣 買い物"},' +
      '"remindAt":4102444200000},"entityChanges":[]}',
  ],
  [
    'large-payload',
    `{"actionPayload":{"task":{"id":"t2","notes":"${'lorem ipsum '.repeat(700)}"}},"entityChanges":[]}`,
  ],
];

const outFile = resolve(process.argv[2] ?? 'android/app/build/live-crypto-fixtures.tsv');
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

const lines = [`password\t${b64(PASSWORD)}`];
for (const [name, plaintext] of ENTRIES) {
  // Fresh session salt per entry — mirrors ops arriving from different devices
  clearSessionKeyCache();
  lines.push(`entry\t${name}\t${b64(plaintext)}\t${await encrypt(plaintext, PASSWORD)}`);
}

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, lines.join('\n') + '\n');
console.log(`Wrote ${ENTRIES.length} live crypto fixtures to ${outFile}`);
