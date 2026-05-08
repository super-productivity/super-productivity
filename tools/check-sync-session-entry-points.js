#!/usr/bin/env node
/**
 * Static check: enumerates all production callers of
 * `SyncSessionValidationService.withSession()` and asserts the set is
 * exactly the known sync entry points.
 *
 * Why brittle on purpose: the latch contract requires every top-level sync
 * entry point to wrap its work in `withSession()`. Adding a new entry point
 * (e.g., a new background download path) without doing so is the
 * maintenance hazard #7330 is most exposed to. This script fails if a new
 * `withSession()` caller appears, forcing the contributor to read the
 * service-level contract before adding to the allow-list here.
 *
 * Known gap (see docs/plans/2026-05-08-sync-run-service-refactor.md):
 * this check enumerates `withSession()` callers — it catches "added a
 * withSession call without updating the list" but not the inverse, "added
 * a sync entry point that *should* call withSession() but doesn't." The
 * runner refactor proposed in that plan would replace this lint with a
 * type-enforced contract.
 *
 * Usage: `node tools/check-sync-session-entry-points.js`
 * Wired into `npm run lint` so CI catches drift without extra steps.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// EVERY entry below must:
// 1. Open a session via `_sessionValidation.withSession(...)`.
// 2. Read `hasFailed()` once at the end of its work and surface ERROR if true.
//
// `reset()` is intentionally NOT a "withSession" caller — it's a sub-scope
// re-scoping helper used only by `_handleLocalDataConflict` USE_REMOTE.
const ALLOWED_ENTRY_POINTS = [
  'SyncWrapperService._sync() — top-level user-initiated sync',
  'SyncWrapperService._forceDownload() — user-initiated force download',
  'WsTriggeredDownloadService._downloadOps() — realtime WS-triggered download',
  'ImmediateUploadService._performUpload() — debounced post-edit upload (SuperSync)',
];

// Files that may legitimately contain `withSession(` references in production
// sources. Tests are excluded — they wrap their setup in `latch.withSession()`
// and are not entry points.
const SCANNED_FILES = [
  'src/app/imex/sync/sync-wrapper.service.ts',
  'src/app/op-log/sync/ws-triggered-download.service.ts',
  'src/app/op-log/sync/immediate-upload.service.ts',
  'src/app/op-log/sync/operation-log-sync.service.ts',
  'src/app/op-log/sync/conflict-resolution.service.ts',
  'src/app/op-log/sync/remote-ops-processing.service.ts',
  'src/app/op-log/sync/rejected-ops-handler.service.ts',
  'src/app/op-log/sync/super-sync-websocket.service.ts',
  'src/app/op-log/persistence/sync-hydration.service.ts',
];

const countWithSessionCalls = (source) => {
  let count = 0;
  const lines = source.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments / JSDoc.
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    // Skip the method definition line itself (lives in the service file,
    // which is not in SCANNED_FILES anyway, but be defensive).
    if (/async\s+withSession\s*</.test(line)) continue;
    const matches = line.match(/\.withSession\s*\(/g);
    if (matches) count += matches.length;
  }
  return count;
};

const expectedTotal = ALLOWED_ENTRY_POINTS.length;
let actualTotal = 0;
const perFile = {};

for (const relFile of SCANNED_FILES) {
  const absPath = path.join(ROOT, relFile);
  if (!fs.existsSync(absPath)) {
    console.error(`❌ Missing scanned file: ${relFile}`);
    process.exit(2);
  }
  const source = fs.readFileSync(absPath, 'utf8');
  const count = countWithSessionCalls(source);
  perFile[relFile] = count;
  actualTotal += count;
}

if (actualTotal !== expectedTotal) {
  console.error(
    `❌ SyncSession entry-point allow-list drift detected.\n\n` +
      `Expected ${expectedTotal} production withSession() callers, found ${actualTotal}.\n\n` +
      `Per file:\n` +
      Object.entries(perFile)
        .filter(([, n]) => n > 0)
        .map(([f, n]) => `  ${f}: ${n}`)
        .join('\n') +
      `\n\nCurrently allowed entry points:\n` +
      ALLOWED_ENTRY_POINTS.map((e) => `  • ${e}`).join('\n') +
      `\n\nIf you intentionally added a new sync entry point: read the contract in\n` +
      `src/app/op-log/sync/sync-session-validation.service.ts, then update\n` +
      `ALLOWED_ENTRY_POINTS in tools/check-sync-session-entry-points.js.\n`,
  );
  process.exit(1);
}

console.log(
  `✅ SyncSession entry-points check: ${actualTotal} production withSession() callers (matches allow-list).`,
);
