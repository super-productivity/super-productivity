import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { isCryptoSubtleAvailable } from '@sp/sync-core';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { SnackService } from '../../core/snack/snack.service';
import { SyncLog } from '../../core/log';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { devError } from '../../util/dev-error';
import { T } from '../../t.const';
import { SyncWrapperService } from './sync-wrapper.service';

const DAY_MS = 24 * 60 * 60 * 1000;

// Calm re-nudge cadence: if the user picks "Later" (or opens the flow and backs
// out), wait this long before reminding again. Long enough not to nag, short
// enough that an E2EE-intended account doesn't sit unencrypted and forgotten.
const SNOOZE_MS = 14 * DAY_MS;

/**
 * SuperSync is meant to be end-to-end encrypted, but configs set up before that
 * became mandatory can still be syncing without a password. This nudges those
 * *established* accounts — calmly, once per app start, dismissible with a snooze —
 * to set a password, which re-uploads their existing data encrypted (no data loss,
 * no server-side deletion of anything the user hasn't migrated).
 *
 * Fresh setups are handled at config time by the setup dialog; this service owns
 * the established/returning cohort so the two never both prompt (see
 * `SyncWrapperService.markPromptEncryptionAfterSetupSync`). Mirrors the calm,
 * device-local, telemetry-free pattern of SyncSafetyBannerService.
 */
@Injectable({ providedIn: 'root' })
export class SuperSyncEncryptionMigrationBannerService {
  private readonly _bannerService = inject(BannerService);
  private readonly _providerManager = inject(SyncProviderManager);
  private readonly _syncWrapperService = inject(SyncWrapperService);
  private readonly _snackService = inject(SnackService);
  private readonly _matDialog = inject(MatDialog);

  async showBannerIfNeeded(): Promise<void> {
    if (!(await this._isMigrationNeeded())) {
      return;
    }

    this._bannerService.open({
      id: BannerId.SuperSyncEncryptionMigration,
      msg: T.APP.B_SUPER_SYNC_ENCRYPTION.MSG,
      ico: 'enhanced_encryption',
      action: {
        label: T.APP.B_SUPER_SYNC_ENCRYPTION.ENABLE,
        fn: () => {
          // Snooze on click too: if the user opens the dialog and cancels, the
          // banner should not immediately reappear next session mid-decision.
          // On success, detection stops anyway (a key is now present).
          this._snooze();
          void this._startMigration().catch(devError);
        },
      },
      action2: {
        label: T.APP.B_SUPER_SYNC_ENCRYPTION.LATER,
        fn: () => this._snooze(),
      },
      isHideDismissBtn: true,
    });
  }

  private async _isMigrationNeeded(): Promise<boolean> {
    const snoozeUntil = +(
      localStorage.getItem(LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL) || 0
    );
    if (snoozeUntil && Date.now() < snoozeUntil) {
      return false;
    }

    // WebCrypto-less clients (insecure context / Android WebView) cannot run
    // enableEncryption() at all — never show an action they can't complete.
    // Their only path is to encrypt on a secure client and enter the password here.
    if (!isCryptoSubtleAvailable()) {
      return false;
    }

    const provider = this._providerManager.getActiveProvider();
    if (
      !provider ||
      provider.id !== SyncProviderId.SuperSync ||
      !isOperationSyncCapable(provider)
    ) {
      return false;
    }

    // isReady() is false for the "encryption flagged on but key missing" state, so
    // this gate also excludes the multi-device "needs the existing password" cohort.
    // Those users must enter their existing password (handled reactively on sync via
    // DecryptNoPasswordError) — they must NOT be offered a destructive re-encrypt.
    if (!(await provider.isReady())) {
      return false;
    }

    // Established: has synced data on the server. A brand-new, never-synced config
    // (seq 0) is a fresh setup, owned by the setup dialog, not this banner.
    if ((await provider.getLastServerSeq()) <= 0) {
      return false;
    }

    // Given isReady() above, an undefined key here means "encryption genuinely off"
    // (the migration target), not "half-configured". A present key = already
    // encrypted = nothing to do.
    const encryptKey = provider.getEncryptKey
      ? await provider.getEncryptKey()
      : undefined;
    return encryptKey === undefined;
  }

  private async _startMigration(): Promise<void> {
    // Re-check against the server RIGHT NOW, immediately before the destructive
    // delete-and-reupload the dialog will run. The banner may have sat on screen
    // for hours; another device could have enabled encryption meanwhile. A fresh
    // sync (download+merge) both refreshes local state — so the reupload doesn't
    // clobber server-only ops — and surfaces a now-encrypted server as a
    // DecryptNoPasswordError (→ enter-password dialog, returns HANDLED_ERROR).
    const result = await this._syncWrapperService.sync(true);
    if (result === 'HANDLED_ERROR') {
      // A password/error dialog is already handling this (e.g. the server turned
      // out to be encrypted by another device). Don't stack a re-encrypt dialog.
      SyncLog.log(
        'SuperSyncEncryptionMigration: pre-sync returned HANDLED_ERROR, deferring',
      );
      return;
    }

    if (!(await this._isServerStillUnencrypted())) {
      this._snackService.open({
        type: 'CUSTOM',
        ico: 'info',
        msg: T.APP.B_SUPER_SYNC_ENCRYPTION.ALREADY_ENCRYPTED,
      });
      return;
    }

    await this._openEnableEncryptionDialog();
  }

  private async _openEnableEncryptionDialog(): Promise<void> {
    const { DialogEnableEncryptionComponent } =
      await import('./dialog-enable-encryption/dialog-enable-encryption.component');
    // initialSetup: false → the escapable variant with a real Cancel (not the
    // dead-end initialSetup modal, see #8671). enableEncryption() re-uploads the
    // freshly-synced state encrypted, with its revert-on-failure safety net.
    this._matDialog.open(DialogEnableEncryptionComponent, {
      data: { providerType: 'supersync', initialSetup: false },
    });
  }

  private async _isServerStillUnencrypted(): Promise<boolean> {
    const provider = this._providerManager.getActiveProvider();
    if (
      !provider ||
      provider.id !== SyncProviderId.SuperSync ||
      !isOperationSyncCapable(provider) ||
      !(await provider.isReady())
    ) {
      return false;
    }
    const encryptKey = provider.getEncryptKey
      ? await provider.getEncryptKey()
      : undefined;
    return encryptKey === undefined;
  }

  private _snooze(): void {
    localStorage.setItem(
      LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL,
      (Date.now() + SNOOZE_MS).toString(),
    );
  }
}
