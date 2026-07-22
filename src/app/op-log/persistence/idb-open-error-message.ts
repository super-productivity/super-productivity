import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';

/**
 * Platform facts the recovery text depends on. Passed in rather than probed
 * here so the builder stays pure and directly testable.
 */
export interface IdbOpenErrorContext {
  isElectron: boolean;
  isFlatpak: boolean;
  isSnap: boolean;
  /** Version of the build showing the dialog (`environment.version`). */
  appVersion: string;
}

const originalMessageOf = (error: IndexedDBOpenError): string =>
  error.originalError instanceof Error
    ? error.originalError.message
    : String(error.originalError);

/**
 * The downgrade barrier rejected an intact database: `DB_VERSION` 8-10 exist
 * precisely to stop an older build from reading newer data (see
 * `db-keys.const.ts`). The generic text must never be shown here — it blames
 * disk space and corruption and ends with "your browser storage may need to be
 * cleared", advice that would destroy perfectly good data and still not let
 * this build open it. The only fix is to run the newer build.
 *
 * @see https://github.com/super-productivity/super-productivity/issues/9187
 */
const versionErrorRecoverySteps = (ctx: IdbOpenErrorContext): string => {
  // Snap and Flatpak are the likeliest way to end up here deliberately: both
  // roll back with a single command (`snap revert`), and Snap `edge` tracks
  // every master push. Sending those users to the website download would be
  // wrong — they need their own update channel.
  if (ctx.isSnap) {
    return (
      '1. Close this window.\n' +
      '2. Update to the newest version: snap refresh super-productivity\n' +
      '3. If you ran `snap revert` recently, that is what caused this.\n\n'
    );
  }
  if (ctx.isFlatpak) {
    return (
      '1. Close this window.\n' +
      '2. Update to the newest version: flatpak update com.super-productivity.app\n\n'
    );
  }
  if (ctx.isElectron) {
    return (
      '1. Close this window.\n' +
      '2. Start the newest version you have installed. If this keeps happening, ' +
      'you likely have a second copy: an outdated desktop shortcut, a portable ' +
      'executable, or an older install folder.\n' +
      '3. Otherwise install the latest release from https://super-productivity.com ' +
      'and launch it from there.\n\n'
    );
  }
  // Web and mobile WebView share a branch: the reload hint is qualified so it
  // stays true on Android/iOS, where there are no tabs and no Ctrl+Shift+R.
  return (
    '1. Make sure you are running the newest version of Super Productivity.\n' +
    '2. In a web browser: reload with Ctrl+Shift+R (Cmd+Shift+R on Mac) and ' +
    'close any other tabs running Super Productivity.\n\n'
  );
};

const buildVersionErrorMessage = (
  error: IndexedDBOpenError,
  ctx: IdbOpenErrorContext,
): string =>
  'Cannot Open Data - This Version Is Too Old\n\n' +
  `You are running Super Productivity ${ctx.appVersion}, but your data was ` +
  'last used by a newer version. Older versions cannot read it.\n\n' +
  'Your data is safe. Do NOT clear your storage — that would delete it.\n\n' +
  'What to do:\n' +
  versionErrorRecoverySteps(ctx) +
  `Technical details: ${originalMessageOf(error)}`;

/**
 * Generic "cannot open the database" guidance, with extra recovery steps for
 * backing-store errors (stale LevelDB lock, sandbox not ready yet).
 *
 * @see https://github.com/johannesjo/super-productivity/issues/6255
 */
const buildGenericErrorMessage = (
  error: IndexedDBOpenError,
  ctx: IdbOpenErrorContext,
): string => {
  let message =
    'Database Error - Cannot Load Data\n\n' +
    'Super Productivity cannot open its database. ' +
    'This may be caused by:\n\n' +
    '- Low disk space\n' +
    '- Temporary file lock (try closing other tabs)\n' +
    '- Storage corruption\n\n';

  if (error.isBackingStoreError) {
    message +=
      'Recovery steps:\n' +
      '1. Close ALL browser tabs and windows\n' +
      '2. Restart the app\n' +
      (ctx.isFlatpak
        ? '3. If using Linux Flatpak with autostart, try disabling autostart and launching manually\n'
        : ctx.isSnap
          ? '3. If using Linux Snap, try: snap set core experimental.refresh-app-awareness=true\n'
          : '3. If using Linux with autostart, try disabling autostart and launching manually\n') +
      '4. If issue persists, check available disk space\n\n';
  }

  return (
    message +
    'If the problem continues after restart, your browser storage may need to be cleared.\n\n' +
    `Technical details: ${originalMessageOf(error)}\n\n` +
    '(Check browser console for full error details)'
  );
};

/**
 * Builds the user-facing recovery text for a failed IndexedDB open.
 *
 * Extracted from `OperationLogHydratorService` so the wording is pure logic and
 * the service stays under the 1200-line cap.
 */
export const buildIdbOpenErrorMessage = (
  error: IndexedDBOpenError,
  ctx: IdbOpenErrorContext,
): string =>
  error.isVersionError
    ? buildVersionErrorMessage(error, ctx)
    : buildGenericErrorMessage(error, ctx);
