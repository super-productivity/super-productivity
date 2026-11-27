import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import { DistChannel } from '../../util/get-app-version-str';

/**
 * Platform facts the recovery text depends on. Passed in rather than probed
 * here so the builder stays pure and directly testable.
 */
export interface IdbOpenErrorContext {
  /** How this build was distributed — decides where "get the newer one" points. */
  channel: DistChannel;
  /** Version of the build showing the dialog (`getAppVersionStr()`). */
  appVersion: string;
  /**
   * False when the platform removed the `indexedDB` global entirely (iOS
   * Lockdown Mode, #11994). Probed by the caller, not parsed from the error
   * text, because the ReferenceError wording differs per engine.
   */
  isIdbAvailable: boolean;
}

const originalMessageOf = (error: IndexedDBOpenError): string =>
  error.originalError instanceof Error
    ? error.originalError.message
    : String(error.originalError);

/**
 * Recovery text that is true on every channel. Each sentence self-qualifies
 * ("If you run it in a browser…"), so a sentence that does not apply reads as
 * skippable rather than wrong — which is what makes this safe to hand to a
 * mis-detected user.
 */
const UNIVERSAL_RECOVERY_STEPS =
  '1. Close this window.\n' +
  '2. Start the newest version of Super Productivity you have installed. If this ' +
  'keeps happening, you likely have a second, older copy: an outdated shortcut, ' +
  'a portable executable, or an old install folder.\n' +
  '3. If you cannot find it, update the way you installed it — your app store, ' +
  'package manager, or https://super-productivity.com\n' +
  '4. If you run it in a browser: reload with Ctrl+Shift+R (Cmd+Shift+R on Mac) ' +
  'and close any other tabs running Super Productivity.\n\n';

/**
 * The downgrade barrier rejected an intact database: `DB_VERSION` 8-10 exist
 * precisely to stop an older build from reading newer data (see
 * `db-keys.const.ts`). The generic text must never be shown here — it blames
 * disk space and corruption and ends with "your browser storage may need to be
 * cleared", advice that would destroy perfectly good data and still not let
 * this build open it. The only fix is to run the newer build.
 *
 * Only Snap and Flatpak get their own text, and the reason is data location,
 * not politeness: both keep the database inside the package sandbox, so
 * "download it from the website" is actively WRONG there — a second install
 * would not even see this data. Everywhere else the universal block is true,
 * so it wins: `DistChannel`'s remaining detectors are UA sniffs and
 * `process.mas`/`process.windowsStore` (the repo already records the former as
 * unreliable), and a confident wrong instruction is worse than a general right
 * one. `default` rather than an exhaustive switch for the same reason — an
 * unknown or future channel must inherit safe text at RUNTIME, which matters
 * more here than a compile error would.
 *
 * Package identifiers per the store links in README.md — snapcraft.io/superproductivity
 * and flathub.org/apps/com.super_productivity.SuperProductivity. They differ from
 * both the top-level `appId` and the mac/Capacitor `com.super-productivity.app`;
 * a wrong id here makes the one command we give the user fail outright.
 *
 * @see https://github.com/super-productivity/super-productivity/issues/9187
 */
const versionErrorRecoverySteps = (channel: DistChannel): string => {
  switch (channel) {
    case 'linux-flatpak':
      // No sudo: polkit's org.freedesktop.Flatpak.app-update is
      // `allow_active=yes`, and adding sudo would break --user installs.
      return (
        '1. Close this window.\n' +
        '2. Update to the newest version:\n' +
        '   flatpak update com.super_productivity.SuperProductivity\n\n'
      );
    case 'linux-snap':
      // sudo IS required: snapd's io.snapcraft.snapd.manage is
      // `auth_admin_keep`, so the bare command dies with "access denied".
      return (
        '1. Close this window.\n' +
        '2. Update to the newest version: sudo snap refresh superproductivity\n' +
        '3. If you ran `snap revert` recently, that is what caused this.\n\n'
      );
    default:
      return UNIVERSAL_RECOVERY_STEPS;
  }
};

const buildVersionErrorMessage = (
  error: IndexedDBOpenError,
  ctx: IdbOpenErrorContext,
): string =>
  'Cannot Open Data - This Version Is Too Old\n\n' +
  `You are running Super Productivity ${ctx.appVersion}, but your data was ` +
  'last used by a newer version. Older versions cannot read it.\n\n' +
  // Deliberately factual rather than "your data is safe": all we know is that
  // this failure touched nothing. The app never opened the database, so it has
  // not read the contents and cannot vouch for them.
  'Nothing was changed or deleted. Do NOT clear your storage — that would ' +
  'erase the data this build simply cannot read.\n\n' +
  'What to do:\n' +
  versionErrorRecoverySteps(ctx.channel) +
  // Without this the message dead-ends: a user whose newer build is gone
  // (reinstall, replaced machine, restored profile) is told what NOT to do and
  // given no way forward, so they search the web, find "clear IndexedDB" and
  // destroy recoverable data. Not forked per channel — this guards the
  // anti-data-loss advice, so a mis-detected channel must not be able to flip
  // it. The desktop half self-qualifies instead.
  'If you cannot run a newer version, do NOT clear this app data — that is what ' +
  'makes the loss permanent. On desktop, copy your Super Productivity data ' +
  'folder somewhere safe before changing anything.\n\n' +
  // No "check the console" pointer here: `Technical details` above already
  // carries the whole error, and 5 of the 13 channels have no console a user
  // can open. It stays in the generic branch, where it is true.
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
      (ctx.channel === 'linux-flatpak'
        ? '3. If using Linux Flatpak with autostart, try disabling autostart and launching manually\n'
        : ctx.channel === 'linux-snap'
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
 * The platform switched IndexedDB off, so no retry, reload or cleanup can
 * help: the generic text's disk-space/corruption causes and "clear storage"
 * advice are wrong here. iOS Lockdown Mode is the known trigger (#11994);
 * excluding the app from its web restrictions restores storage. The browser
 * sentence self-qualifies, so the text stays true on every channel.
 */
const buildUnavailableErrorMessage = (error: IndexedDBOpenError): string =>
  'Storage Turned Off - Cannot Save Data\n\n' +
  'Super Productivity cannot load or save anything because your device has ' +
  'turned off the storage it needs (IndexedDB). Super Productivity did not ' +
  'change or delete anything, and clearing storage would not help.\n\n' +
  'On iPhone or iPad this is usually caused by Lockdown Mode. To keep Lockdown Mode on ' +
  'and still use the app, go to Settings > Privacy & Security > Lockdown Mode > ' +
  'Configure Web Browsing and exclude Super Productivity, then restart the app.\n\n' +
  'If you run it in a browser, allow this site to store data and do not use a ' +
  'mode that blocks site storage.\n\n' +
  `Technical details: ${originalMessageOf(error)}`;

/**
 * Builds the user-facing recovery text for a failed IndexedDB open.
 *
 * Extracted from `OperationLogHydratorService` so the wording is pure logic and
 * the service stays under the 1200-line cap.
 */
export const buildIdbOpenErrorMessage = (
  error: IndexedDBOpenError,
  ctx: IdbOpenErrorContext,
): string => {
  if (!ctx.isIdbAvailable) {
    return buildUnavailableErrorMessage(error);
  }
  return error.isVersionError
    ? buildVersionErrorMessage(error, ctx)
    : buildGenericErrorMessage(error, ctx);
};
