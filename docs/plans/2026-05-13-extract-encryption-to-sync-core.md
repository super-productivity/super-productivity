# Extract Encryption Primitives to `@sp/sync-core` (v2)

> **Status: ✅ Complete.** Extraction merged via `049dbb5e53` (initial), then
> follow-up multi-review rounds that:
>
> - collapsed the WebCrypto/`@noble` strategy pattern into flat `aesEncrypt`/`aesDecrypt` helpers
> - split the original 741-line module into five focused files under `packages/sync-core/src/encryption/`
> - moved test coverage to `packages/sync-core/tests/encryption.spec.ts` (vitest, 48 tests) plus a Karma smoke spec at `src/app/op-log/encryption/encryption.browser.spec.ts`
> - added `setLegacyKdfWarningHandler` as a side-channel diagnostic complementing `decryptWithMigration`'s structural `wasLegacyKdf`
> - hardened the public barrel to match the originally-planned surface and added an `instanceof` regression guard for `WebCryptoNotAvailableError` in `sync-errors.identity.spec.ts`
> - simplified `OperationEncryptionService` (dropped the `_encrypt`/`_decrypt` private aliasing) and replaced `mock-encryption.helper.ts` with real encryption under weakened Argon2 params (`setArgon2ParamsForTesting({ memorySize: 8, iterations: 1 })`)
>
> The historical plan below is preserved for context.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move only the pure-function encryption primitives (`encryption.ts`, 704 lines) out of `src/app/op-log/encryption/` and into `@sp/sync-core`. Keep `EncryptAndCompressHandler` and `compression-handler.ts` (the app-specific error/prefix translation wrappers) in `src/`. Keep `OperationEncryptionService` in `src/` as the Angular DI wrapper.

**Why now:**

1. The existing `@sp/sync-core` already hosts framework-agnostic sync code; encryption fits its stated purpose ("framework-agnostic core types and utilities for Super Productivity sync").
2. `super-sync-server` is in the same monorepo and may want server-side encrypted-snapshot support later — having `encrypt/decrypt` in the package makes that one import, not a port.
3. Reduces app surface (~700 lines off `src/`) and lets the package build/typecheck independently.
4. Compression is already extracted with the same pattern; encryption is the logical follow-up.

**Architecture:** `encryption.ts` is already pure (no Angular, no DI, no Electron). Its only app couplings are: (a) one `Log.warn` call, (b) `WebCryptoNotAvailableError` imported from `op-log/core/errors/sync-errors.ts`. The first is folded into `DecryptResult` (return diagnostics structurally). The second is moved to the package and re-exported from `sync-errors.ts` so `instanceof` identity is preserved at the two app-side check sites.

**Tech Stack:** TypeScript strict, tsup (dual ESM+CJS), Vitest (package), Jasmine/Karma (app specs stay in `src/`), `hash-wasm` (Argon2id), `@noble/ciphers` (AES-GCM fallback).

---

## What's moving vs. what's staying — corrected scope

**Moving to `@sp/sync-core`:**

- `src/app/op-log/encryption/encryption.ts` → `packages/sync-core/src/encryption.ts`
- `WebCryptoNotAvailableError` class from `sync-errors.ts:409-…` → `packages/sync-core/src/encryption.ts` (or sibling file)

**Staying in `src/` (verified app-coupled):**

- `src/app/op-log/encryption/encrypt-and-compress-handler.service.ts` — imports `getSyncFilePrefix`/`extractSyncFileStateFromPrefix` from `util/sync-file-prefix.ts`, throws `DecryptNoPasswordError` / `JsonParseError` / app-specific `DecryptError`. Not portable without a separate redesign.
- `src/app/op-log/encryption/compression-handler.ts` — wrapper that injects `createCompressError: (e) => new CompressError(e)` and `APP_COMPRESSION_LOG_MESSAGES`. Deletion would drop `CompressError`/`DecompressError` typing and the error-message rewrite. Out of scope.
- `src/app/op-log/sync/operation-encryption.service.ts` — Angular `@Injectable` wrapper typing primitives over `SyncOperation`. Stays; imports primitives from `@sp/sync-core` after Task 3.

**Specs:** stay in `src/` and run under Karma against the package. Reason: Karma uses real Chrome (full Web Crypto), the specs spy heavily on `window.crypto.subtle`, and porting ~790 lines of Jasmine to Vitest is pure churn. The package gets a small smoke test for the public API.

**Public API added to `@sp/sync-core`:**

- `encrypt`, `decrypt`, `encryptBatch`, `decryptBatch`
- `generateKey`, `deriveKeyFromPassword`, `encryptWithDerivedKey`, `decryptWithDerivedKey`
- `decryptWithMigration`
- `getCryptoStrategy`, `isCryptoSubtleAvailable`
- `clearSessionKeyCache`, `getSessionKeyCacheStats`
- `getArgon2Params`, `setArgon2ParamsForTesting` _(guarded — throws in production)_
- `base642ab`, `ab2base64`
- `WebCryptoNotAvailableError`
- Types: `DerivedKeyInfo`, `DecryptResult` _(extended with `wasLegacyKdf?: boolean`)_, `CryptoStrategy`

**Removed from plan vs. v1 (review-driven):**

- `EncryptionDecryptError` + `createDecryptError` injection hook — `encryption.ts` throws zero `DecryptError`. Don't invent infrastructure for a problem the moved file doesn't have.
- `setEncryptionLogger` + module-level mutable `_logger` — replaced with structural return value.
- Vitest port of ~1300 spec lines — specs stay in `src/`.
- Task 3 ("port `EncryptAndCompressHandler`") — handler is not portable; out of scope.
- Splitting `EncryptAndCompressCfg` across the boundary — not needed since handler stays.

---

## Task Sequence

1. Move `WebCryptoNotAvailableError` to `@sp/sync-core` with cross-import re-export at the app boundary
2. Move `encryption.ts` to `@sp/sync-core` (single warn-line refactor)
3. Rewire all in-app consumers in one mechanical commit
4. Delete `src/app/op-log/encryption/encryption.ts`
5. Verification (typecheck, unit, lint, build, e2e smoke)
6. PR cleanup

---

## Task 1: Move `WebCryptoNotAvailableError` to the package

**Goal:** Single error class, single identity. Preserve `instanceof` checks at `sync-wrapper.service.ts:728` (`DecryptError` — owned by handler, not moved here) and `:754` (`WebCryptoNotAvailableError`).

**Files:**

- Create: `packages/sync-core/src/web-crypto-error.ts`
- Modify: `packages/sync-core/src/index.ts`
- Modify: `src/app/op-log/core/errors/sync-errors.ts:409-…` — replace the class with a re-export from the package

**Step 1: Read current `WebCryptoNotAvailableError` shape**

```bash
sed -n '405,420p' src/app/op-log/core/errors/sync-errors.ts
```

Expected: `export class WebCryptoNotAvailableError extends Error { override name = 'WebCryptoNotAvailableError'; ... }` — no `AdditionalLogErrorBase` parent, no extra fields. Confirm before moving (if it has extra fields, fold them into the package class).

**Step 2: Create the class in the package**

Write `packages/sync-core/src/web-crypto-error.ts`:

```typescript
export class WebCryptoNotAvailableError extends Error {
  override name = 'WebCryptoNotAvailableError';
  constructor(message = 'Web Crypto API (window.crypto.subtle) is not available') {
    super(message);
  }
}
```

(If Step 1 showed extra fields, mirror them here.)

**Step 3: Export from the package barrel**

Modify `packages/sync-core/src/index.ts` — add:

```typescript
export { WebCryptoNotAvailableError } from './web-crypto-error';
```

**Step 4: Replace the app class with a re-export**

In `src/app/op-log/core/errors/sync-errors.ts` find the `WebCryptoNotAvailableError` class definition (around line 409). Replace with:

```typescript
export { WebCryptoNotAvailableError } from '@sp/sync-core';
```

This preserves identity for **both** call sites:

- `sync-wrapper.service.ts:754` imports `WebCryptoNotAvailableError` from `sync-errors.ts` → resolves through re-export to the package class.
- `src/app/util/create-sha-1-hash.ts:1` (consumer found by reviewers) — same path.

**Step 5: Build the package and verify the export**

```bash
cd packages/sync-core && npm run build && grep -l WebCryptoNotAvailableError dist/index.d.ts dist/index.d.mts
```

Expected: both `.d.ts` and `.d.mts` contain the export.

**Step 6: Run the app's typecheck**

```bash
npx tsc --noEmit -p tsconfig.app.json 2>&1 | head -30
```

Expected: 0 errors. If errors mention `WebCryptoNotAvailableError`, the re-export path is wrong.

**Step 7: checkFile**

```bash
npm run checkFile src/app/op-log/core/errors/sync-errors.ts
```

Expected: clean.

**Step 8: Commit**

```bash
git add packages/sync-core/src/web-crypto-error.ts packages/sync-core/src/index.ts src/app/op-log/core/errors/sync-errors.ts
git commit -m "refactor(sync-core): move WebCryptoNotAvailableError into package"
```

---

## Task 2: Port `encryption.ts` to `@sp/sync-core`

**Goal:** Move the primitives. Eliminate the one `Log.warn` site by returning the legacy-KDF flag in `DecryptResult` instead of logging in the primitive. Guard `setArgon2ParamsForTesting` against production callers.

**Files:**

- Create: `packages/sync-core/src/encryption.ts`
- Create: `packages/sync-core/tests/encryption.spec.ts` _(smoke test only)_
- Modify: `packages/sync-core/src/index.ts`
- Modify: `packages/sync-core/tsconfig.json` (add DOM lib)
- Modify: `packages/sync-core/package.json` (add deps)
- Modify: `packages/sync-core/src/encryption.ts` (refactor `Log.warn` site)

**Step 1: Add DOM lib to package tsconfig**

Edit `packages/sync-core/tsconfig.json`:

```json
"lib": ["ES2022", "DOM"],
```

Without DOM, `window.crypto.subtle` references (~14 sites in `encryption.ts`) won't typecheck.

**Step 2: Add deps via npm workspaces — do NOT install in sub-package**

Edit `packages/sync-core/package.json` `dependencies`:

```json
"dependencies": {
  "hash-wasm": "^4.12.0",
  "@noble/ciphers": "^2.2.0"
}
```

Run install from the **repo root** so npm workspaces hoists (no nested `node_modules/hash-wasm`):

```bash
npm install
```

Expected: only one copy of each. Verify:

```bash
npm ls hash-wasm @noble/ciphers
```

Expected: single resolved version each. If two versions surface (root + nested), align versions or downgrade to `peerDependencies`.

**Step 3: Copy `encryption.ts` to the package**

```bash
cp src/app/op-log/encryption/encryption.ts packages/sync-core/src/encryption.ts
```

Then edit `packages/sync-core/src/encryption.ts`:

1. Replace the imports block at the top:

```typescript
// OLD (lines 1-4):
import { argon2id } from 'hash-wasm';
import { gcm } from '@noble/ciphers/aes.js';
import { WebCryptoNotAvailableError } from '../core/errors/sync-errors';
import { Log } from '../../core/log';

// NEW:
import { argon2id } from 'hash-wasm';
import { gcm } from '@noble/ciphers/aes.js';
import { WebCryptoNotAvailableError } from './web-crypto-error';
```

(Note: `Log` import dropped entirely — see Step 4.)

**Step 4: Replace `Log.warn` with structural diagnostic**

Find the single `Log.warn` site (line ~362). Read 10 lines of context:

```bash
grep -n "Log\." packages/sync-core/src/encryption.ts
```

It lives inside `decryptWithMigration` and emits a one-shot legacy-PBKDF2 warning.

Apply two changes:

(a) Extend the existing `DecryptResult` interface (line ~424 in the source). Add `wasLegacyKdf?: boolean`:

```typescript
export interface DecryptResult {
  plaintext: string;
  wasLegacyKdf?: boolean;
}
```

(b) In `decryptWithMigration`, remove the `Log.warn(...)` call. Where the warning would fire, set `wasLegacyKdf: true` in the returned `DecryptResult`. The caller (`OperationEncryptionService`, `EncryptAndCompressHandlerService`) is responsible for logging if it cares — both already have `Log` access in app context.

**Step 5: Guard `setArgon2ParamsForTesting`**

Locate the function (line ~29). Add a production guard:

```typescript
export const setArgon2ParamsForTesting = (params: typeof DEFAULT_ARGON2_PARAMS): void => {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    throw new Error('setArgon2ParamsForTesting must not be called in production');
  }
  _argon2Params = params;
};
```

This blocks accidental prod use without changing the testing API.

**Step 6: Add encryption exports to the package barrel**

Modify `packages/sync-core/src/index.ts` — append:

```typescript
// Encryption primitives — Argon2id KDF + AES-GCM, Web Crypto with @noble fallback.
export {
  encrypt,
  decrypt,
  encryptBatch,
  decryptBatch,
  generateKey,
  deriveKeyFromPassword,
  encryptWithDerivedKey,
  decryptWithDerivedKey,
  decryptWithMigration,
  getCryptoStrategy,
  isCryptoSubtleAvailable,
  clearSessionKeyCache,
  getSessionKeyCacheStats,
  getArgon2Params,
  setArgon2ParamsForTesting,
  base642ab,
  ab2base64,
} from './encryption';
export type { DerivedKeyInfo, DecryptResult } from './encryption';
```

**Step 7: Add a smoke test (matches the existing `*.spec.ts` glob)**

Write `packages/sync-core/tests/encryption.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  isCryptoSubtleAvailable,
  WebCryptoNotAvailableError,
} from '../src';

describe('encryption (smoke)', () => {
  it('exposes Web Crypto availability check', () => {
    expect(typeof isCryptoSubtleAvailable()).toBe('boolean');
  });

  it('round-trips a string through encrypt/decrypt with the same password', async () => {
    if (!isCryptoSubtleAvailable()) {
      // Node 20+ provides globalThis.crypto; if the test env is older skip.
      return;
    }
    const plaintext = 'hello sync world';
    const ciphertext = await encrypt(plaintext, 'correct horse battery staple');
    expect(ciphertext).not.toBe(plaintext);
    const result = await decrypt(ciphertext, 'correct horse battery staple');
    expect(result.plaintext).toBe(plaintext);
  });

  it('exports WebCryptoNotAvailableError', () => {
    expect(new WebCryptoNotAvailableError()).toBeInstanceOf(Error);
  });
});
```

**Step 8: Run the package tests**

```bash
cd packages/sync-core && npm test
```

Expected: smoke spec passes. Node 20+ provides `globalThis.crypto` natively — no jsdom needed. If Node 18 (unlikely given repo's engine target), the second test will skip via the early return.

**Step 9: Build the package**

```bash
cd packages/sync-core && npm run build
```

Expected: clean dual build. Verify the type declarations:

```bash
grep -E "(encrypt|decrypt|WebCryptoNotAvailableError)" packages/sync-core/dist/index.d.ts | head
```

Expected: all surface present.

**Step 10: Commit**

```bash
git add packages/sync-core/
git commit -m "feat(sync-core): add encryption primitives"
```

---

## Task 3: Rewire all in-app consumers

**Goal:** Single mechanical commit covering every consumer of the soon-to-be-deleted `src/app/op-log/encryption/encryption.ts`. No code logic changes — only import paths.

**Files (verified by grep before starting):**

```bash
grep -rnE "from ['\"](.*)op-log/encryption/encryption['\"]" src/app --include="*.ts" | grep -v "\.spec\.ts"
```

Expected hits (from review context):

- `src/app/imex/sync/sync-config.service.ts`
- `src/app/imex/sync/file-based-encryption.service.ts`
- `src/app/imex/sync/encryption-password-change.service.ts`
- `src/app/imex/sync/snapshot-upload.service.ts`
- `src/app/op-log/encryption/encrypt-and-compress-handler.service.ts` (`decryptBatch`, `encryptBatch`)
- `src/app/op-log/sync/operation-encryption.service.ts` (`encrypt`, `decrypt`, `encryptBatch`, `decryptBatch`)
- `src/app/op-log/encryption/encryption.spec.ts` (path: `./encryption` → `@sp/sync-core`)

Also rerun the grep for `WebCryptoNotAvailableError` direct imports — the Task 1 re-export should cover them, but double-check:

```bash
grep -rnE "WebCryptoNotAvailableError" src/app --include="*.ts" | grep -v "\.spec\.ts"
```

**Step 1: Update every import**

In each file above, replace:

```typescript
// OLD:
import { ... } from '../../op-log/encryption/encryption';
// OR (handler):
import { decryptBatch, encryptBatch } from './encryption';
// NEW:
import { ... } from '@sp/sync-core';
```

For the spec file (`src/app/op-log/encryption/encryption.spec.ts`):

```typescript
// OLD: import { encrypt, decrypt, ... } from './encryption';
// NEW: import { encrypt, decrypt, ... } from '@sp/sync-core';
```

**Step 2: Wire the legacy-KDF warning at the app boundary**

In `src/app/op-log/sync/operation-encryption.service.ts`, find calls to `decryptWithMigration` (if any). Wherever `decryptWithMigration` is called, if the returned `DecryptResult.wasLegacyKdf === true`, emit:

```typescript
Log.warn('Encrypted payload used legacy PBKDF2 KDF; re-encrypting with Argon2id');
```

If `decryptWithMigration` is called from `encrypt-and-compress-handler.service.ts` instead (likely — it's the migration glue), put the warning there. Grep first:

```bash
grep -rn "decryptWithMigration" src/app --include="*.ts" | grep -v "\.spec\.ts"
```

Apply the warning at the call site that's closest to user-visible flow. **If the warning was never functionally important** (i.e. silently dropping it is fine), leave the flag in the result type and skip the log call. Decide based on whether any user-facing UX depends on it — grep for any reference in tests:

```bash
grep -rn "legacy.*KDF\|PBKDF2.*deprecat" src/app --include="*.ts"
```

**Step 3: Run every consumer's spec**

```bash
npm run test:file src/app/op-log/encryption/encryption.spec.ts
npm run test:file src/app/op-log/sync/operation-encryption.service.spec.ts
npm run test:file src/app/imex/sync/sync-config.service.spec.ts
npm run test:file src/app/imex/sync/file-based-encryption.service.spec.ts
npm run test:file src/app/imex/sync/encryption-password-change.service.spec.ts
npm run test:file src/app/imex/sync/snapshot-upload.service.spec.ts
npm run test:file src/app/op-log/encryption/encrypt-and-compress-handler.service.spec.ts
```

Expected: all pass. If `encryption.spec.ts` fails, the most likely cause is a function exported by the source file but not by the package barrel — fix the barrel (Task 2 Step 6), don't fix the spec.

**Step 4: checkFile every modified file**

```bash
for f in <list-from-step-1>; do npm run checkFile $f || break; done
```

**Step 5: Commit**

```bash
git add src/
git commit -m "refactor(sync): consume encryption primitives from @sp/sync-core"
```

---

## Task 4: Delete `src/app/op-log/encryption/encryption.ts`

**Goal:** Remove the now-orphan source file. Keep `encrypt-and-compress-handler.service.ts`, `compression-handler.ts`, and all specs.

**Step 1: Confirm zero remaining imports from the file**

```bash
grep -rnE "from ['\"](.*)op-log/encryption/encryption['\"]" src/ --include="*.ts"
```

Expected: only `encryption.spec.ts` co-located file (which now imports from `@sp/sync-core`, so the grep above checking the **source** path returns zero matches). If any non-spec match, return to Task 3 and finish before deleting.

**Step 2: Delete the file**

```bash
git rm src/app/op-log/encryption/encryption.ts
```

The spec stays in place; it now points at `@sp/sync-core`.

**Step 3: Check `sync-exports.ts` for re-exports**

```bash
grep -n "encryption" src/app/op-log/sync-exports.ts
```

If any re-export from `./encryption/encryption` exists, replace with a re-export from `@sp/sync-core` (matching the consumer expectation).

**Step 4: Typecheck the app**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: 0 errors.

**Step 5: Commit**

```bash
git add -u
git commit -m "refactor(op-log): remove src copy of encryption primitives"
```

---

## Task 5: Verification

**Step 1: Full unit suite**

```bash
npm test
```

Expected: green. If the encryption spec specifically fails on Karma despite passing in isolation, suspect path mapping in `tsconfig.spec.json` — confirm `@sp/sync-core` is mapped to the built `dist`.

**Step 2: Type-check the whole repo**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

**Step 3: Lint every changed file**

```bash
git diff --name-only master...HEAD | grep -E "\.(ts|scss)$" | xargs -n1 -I{} npm run checkFile {}
```

Expected: all clean.

**Step 4: Bundle-size diff**

Build prod twice — once on master, once on HEAD — and compare:

```bash
git stash
git checkout master -- packages/ src/
npm run dist -- --no-publish --linux 2>&1 | tail -5
du -sb dist/ > /tmp/size-master.txt
git stash pop  # or git checkout HEAD -- to restore
npm run dist -- --no-publish --linux 2>&1 | tail -5
du -sb dist/ > /tmp/size-head.txt
diff /tmp/size-master.txt /tmp/size-head.txt
```

Expected: delta within ±5KB (no `hash-wasm` duplication). If significantly larger, run:

```bash
npm ls hash-wasm @noble/ciphers
```

A second resolved copy is the most likely cause; fix via workspace dedup before merging.

**Step 5: E2E smoke**

```bash
ls e2e/src/ | grep -i sync
npm run e2e:file e2e/src/<sync-spec>.e2e-spec.ts -- --retries=0
```

Expected: PASS.

**Step 6: Manual verification of the two `instanceof` sites**

```bash
grep -nE "instanceof (DecryptError|WebCryptoNotAvailableError)" src/app/imex/sync/sync-wrapper.service.ts
```

Expected: both lines still present, unchanged. Confirm UX by:

- Running the app, forcing a decrypt failure (wrong password), verifying the password-prompt dialog appears.
- (If feasible) Running in a context without `crypto.subtle` and verifying the WebCrypto-unavailable snackbar appears.

If these manual checks aren't feasible, at minimum ensure `npm run test:file src/app/imex/sync/sync-wrapper.service.spec.ts` passes — the spec likely covers both branches.

**Step 7: No commit — verification only.**

---

## Task 6: PR-ready cleanup

**Step 1: Final diff audit**

```bash
git log --oneline master..HEAD
git diff --stat master...HEAD
```

Expected: ~4 commits, net negative line count on `src/` (encryption.ts deleted, no new files added apart from re-export shims).

**Step 2: Docs check**

```bash
grep -rn "op-log/encryption/encryption\|src/app/op-log/encryption" docs/ CLAUDE.md
```

If references exist, update to `@sp/sync-core`. Commit:

```bash
git commit -m "docs(sync): update encryption references to @sp/sync-core"
```

**Step 3: Worktree clean check**

```bash
git status
```

Expected: clean.

**Step 4: PR draft (do NOT push without user approval)**

Title: `refactor(sync): extract encryption primitives to @sp/sync-core`

Body draft (use HEREDOC at PR time):

- Summary
  - Moves `encryption.ts` (~700 lines) and `WebCryptoNotAvailableError` into `@sp/sync-core`
  - Replaces module-level `Log.warn` with structural `DecryptResult.wasLegacyKdf` so primitives stay pure
  - `EncryptAndCompressHandler`, `compression-handler.ts`, and all dialogs stay in `src/` (app-coupled)
  - Specs stay in `src/` and run under Karma against the package (no Jasmine→Vitest port)
- Test plan
  - `npm test` green
  - `npx tsc --noEmit` clean
  - Sync e2e smoke passes
  - Prod bundle within ±5KB vs. master (no `hash-wasm` duplication)
  - Manual check: wrong-password dialog still fires; Capacitor WebCrypto fallback path intact

---

## Risk Register

- **`hash-wasm` / `@noble/ciphers` duplication in the prod bundle.** Mitigation: Task 2 Step 2 uses workspace install from root, not `cd packages/sync-core && npm install`. Task 5 Step 4 explicitly diffs bundle size and runs `npm ls`.
- **`instanceof DecryptError` at `sync-wrapper.service.ts:728`.** `DecryptError` is thrown by `encrypt-and-compress-handler.service.ts` (which stays in `src/`), not by `encryption.ts`. No change needed — flagged as a non-risk by review verification.
- **`instanceof WebCryptoNotAvailableError` at `sync-wrapper.service.ts:754` and `create-sha-1-hash.ts:1`.** Mitigation: Task 1 replaces the app class with a re-export of the package class, so identity is single. Same for `sync-exports.ts:39`.
- **Module-level state across dual ESM/CJS resolution.** Session-key cache and `_argon2Params` are module-scoped; if a consumer mixed `import` and `require`, two instances would coexist. Mitigation: Angular app uses ESM only; smoke test (Task 2 Step 7) round-trips through the published entry; bundle-size diff (Task 5 Step 4) would surface a double-resolve.
- **`setArgon2ParamsForTesting` callable from prod code.** Mitigated in Task 2 Step 5 with a `NODE_ENV === 'production'` guard.
- **Karma can't resolve `@sp/sync-core` after the package is built.** Verify `tsconfig.spec.json` `paths` includes `@sp/sync-core` → `packages/sync-core/dist`. If missing, add before Task 3 Step 3.
- **`decryptWithMigration` log loss.** The one `Log.warn` becomes a `DecryptResult.wasLegacyKdf` flag. Task 3 Step 2 wires the warning at the app boundary; if the warning turns out to be load-bearing for support/debugging, the boundary log preserves it.

---

## Out of Scope (deliberately)

- Moving `EncryptAndCompressHandler` — has hard imports of `getSyncFilePrefix`, `extractSyncFileStateFromPrefix`, `DecryptNoPasswordError`, `JsonParseError`, `DecryptError`. Would need a separate plan with prefix-helper injection design.
- Deleting `compression-handler.ts` — not a duplicate; it wraps the package's compression with app-specific error translation (`createCompressError: (e) => new CompressError(e)`) and `APP_COMPRESSION_LOG_MESSAGES`. Removing it would silently break error typing for callers.
- Inlining `OperationEncryptionService` into its 3 consumers (Architecture and Simplicity reviewers' suggestion) — separate refactor; would simplify but isn't required for the extraction.
- Vitest port of `encryption.spec.ts` — defer until the package gains a second consumer that benefits from independent test execution.
- Deduplicating `src/app/core/util/vector-clock.ts` against `@sp/sync-core/vector-clock` — separate plan, already noted.
- Extracting `LockService` — separate plan; low value standalone.
