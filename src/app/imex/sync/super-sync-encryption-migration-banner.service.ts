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
        // Snooze is deferred into _startMigration (only once we actually reach the
        // migration dialog), so a transient pre-sync failure doesn't silently hide
        // the nudge for the whole snooze window.
        fn: () => void this._startMigration().catch(devError),
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

    // isReady() is false only for the HALF-configured state (encryption flagged on
    // but key missing), so that variant is excluded here. A device that synced
    // BEFORE encryption existed (isEncryptionEnabled:false) whose peer later enabled
    // it still passes this gate and may briefly show a not-yet-accurate nudge — that
    // case is caught safely in _startMigration(), where the pre-action sync(true)
    // hits DecryptNoPasswordError → HANDLED_ERROR and we defer to the enter-password
    // flow rather than offering a destructive re-encrypt.
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
    // Refresh against the server RIGHT NOW, before the destructive
    // delete-and-reupload the dialog will run. The banner may have sat on screen
    // for hours; a peer could have enabled encryption meanwhile. A fresh sync
    // (download+merge) both refreshes local state — so the reupload doesn't clobber
    // server-only ops — and surfaces a now-encrypted server as a
    // DecryptNoPasswordError → HANDLED_ERROR (the enter-password flow then owns it).
    const result = await this._syncWrapperService.sync(true);
    if (result === 'HANDLED_ERROR') {
      // Offline, or a password/error dialog is already handling this. Defer WITHOUT
      // snoozing so the nudge returns next session (the user asked to encrypt but
      // never reached the decision).
      SyncLog.log(
        'SuperSyncEncryptionMigration: pre-sync returned HANDLED_ERROR, deferring',
      );
      return;
    }

    // Re-run the full eligibility check post-sync (same predicate as the banner).
    // If the account turned out to be encrypted (a peer enabled it), this is now
    // false — inform the user (the reactive enter-password flow handles the real
    // credential step) rather than offering a destructive re-encrypt under a new key.
    if (!(await this._isMigrationNeeded())) {
      this._snackService.open({
        type: 'CUSTOM',
        ico: 'info',
        msg: T.APP.B_SUPER_SYNC_ENCRYPTION.ALREADY_ENCRYPTED,
      });
      return;
    }

    // Don't stack on another open dialog (e.g. an enter-password prompt). Skip
    // without snoozing so the nudge returns next session.
    if (this._matDialog.openDialogs.length > 0) {
      return;
    }

    // Reached the migration decision: snooze now so backing out of the dialog
    // doesn't re-nag next session (a successful enable stops detection anyway).
    this._snooze();
    await this._openEnableEncryptionDialog();
  }

  private async _openEnableEncryptionDialog(): Promise<void> {
    const { DialogEnableEncryptionComponent } =
      await import('./dialog-enable-encryption/dialog-enable-encryption.component');
    // initialSetup: false → the escapable variant with a real Cancel (not the
    // dead-end initialSetup modal, see #8671). Deliberately NOT routed through
    // EncryptionPasswordDialogOpenerService.openEnableEncryptionDialog: that helper
    // forces disableClose:true, which would remove the escapability that is the
    // whole point of this calm banner. enableEncryption() re-uploads the
    // freshly-synced state encrypted, with its revert-on-failure safety net.
    this._matDialog.open(DialogEnableEncryptionComponent, {
      data: { providerType: 'supersync', initialSetup: false },
    });
  }

  private _snooze(): void {
    localStorage.setItem(
      LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL,
      (Date.now() + SNOOZE_MS).toString(),
    );
  }
}
