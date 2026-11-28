import { test } from '@playwright/test';

/**
 * Records the moments where a shared sync helper made a decision on a test's
 * behalf instead of letting the test see it, such as answering a dialog
 * silently or accepting a weaker completion signal.
 *
 * Each record is one greppable stdout line, `[E2E-AUDIT] kind=… test="…" detail="…"`,
 * plus a Playwright annotation. A full CI run can then list exactly which tests
 * depend on which silent behavior. That list is what tightening the helper
 * defaults needs, without guessing across 1,200 call sites.
 *
 * Recording never changes behavior and never throws.
 */
export type SyncAuditKind =
  | 'auto-answer:fresh-client'
  | 'auto-answer:sync-import'
  | 'auto-answer:enter-password'
  | 'auto-answer:enable-encryption'
  | 'auto-answer:decrypt-error'
  | 'auto-answer:native-confirm'
  | 'setup:initial-sync-unwitnessed'
  | 'webdav:conflict-returned'
  | 'webdav:response-only-completion'
  | 'dev-error-dismissed';

const currentTestLabel = (): string => {
  try {
    const info = test.info();
    const file = info.file.split(/[\\/]e2e[\\/]/).pop() ?? info.file;
    return `${file} > ${info.titlePath.slice(1).join(' > ')}`;
  } catch {
    return '<outside test>';
  }
};

const oneLine = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, 160);

export const recordSyncAudit = (kind: SyncAuditKind, detail = ''): void => {
  const label = currentTestLabel();
  console.log(
    `[E2E-AUDIT] kind=${kind} test="${oneLine(label)}" detail="${oneLine(detail)}"`,
  );
  try {
    test.info().annotations.push({ type: 'e2e-audit', description: `${kind} ${detail}` });
  } catch {
    // Outside a running test: the log line is enough.
  }
};
