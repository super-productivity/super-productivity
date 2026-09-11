import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import { SyncLog } from '../../core/log';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { T } from '../../t.const';
import { SyncWrapperService } from './sync-wrapper.service';

export type EncryptionSetupOutcome = 'opened' | 'deferred' | 'not_needed';

/**
 * The single click-time gate in front of the SuperSync enable-encryption dialog.
 * That dialog is destructive — enabling deletes ALL server data and re-uploads
 * this device's local state — so every UI entry point (the migration banner, the
 * sync-paused snack) MUST funnel through here rather than opening the dialog
 * directly. The nudge may have sat on screen for hours; a peer device could have
 * enabled encryption and uploaded newer data meanwhile, and an unguarded click
 * would wipe that with stale local state under a new password.
 */
@Injectable({ providedIn: 'root' })
export class SuperSyncEncryptionSetupService {
  private readonly _syncWrapperService = inject(SyncWrapperService);
  private readonly _providerManager = inject(SyncProviderManager);
  private readonly _snackService = inject(SnackService);
  private readonly _matDialog = inject(MatDialog);

  /**
   * Refreshes against the server, re-checks that encryption setup is still
   * needed, and only then opens the enable-encryption dialog:
   *
   * 1. A fresh user-triggered sync — so the later re-upload cannot clobber
   *    server-only ops, and a remote a peer encrypted meanwhile surfaces as
   *    DecryptNoPasswordError → HANDLED_ERROR (the enter-password flow owns it).
   *    User-triggered so real failures (network, timeout, integrity) still show
   *    their snacks; only the encryption-required snack is suppressed — this
   *    flow already owns that interaction and would otherwise re-arm the very
   *    snack whose click started it.
   * 2. `isStillNeeded` re-checked AFTER that sync (defaults to "active provider
   *    is SuperSync and has no encryption key"); if setup happened elsewhere in
   *    the meantime the user is informed instead of offered a destructive
   *    re-encrypt.
   * 3. No stacking on an already-open dialog (e.g. an enter-password prompt).
   *
   * 'deferred' outcomes show no extra UI of their own: the preflight either
   * already surfaced the failure (error snack / password dialog) or another
   * dialog owns the screen. Callers decide whether to re-nudge later.
   */
  async syncThenOfferSetup(opts?: {
    isStillNeeded?: () => Promise<boolean>;
  }): Promise<EncryptionSetupOutcome> {
    const result = await this._syncWrapperService.sync(true, {
      suppressEncryptionRequiredSnack: true,
    });
    if (result === 'HANDLED_ERROR') {
      SyncLog.log(
        'SuperSyncEncryptionSetup: preflight sync did not complete — deferring setup',
      );
      return 'deferred';
    }

    const isStillNeeded = opts?.isStillNeeded ?? (() => this._isEncryptKeyMissing());
    if (!(await isStillNeeded())) {
      this._snackService.open({
        type: 'CUSTOM',
        ico: 'info',
        msg: T.APP.B_SUPER_SYNC_ENCRYPTION.ALREADY_ENCRYPTED,
      });
      return 'not_needed';
    }

    if (this._matDialog.openDialogs.length > 0) {
      SyncLog.log('SuperSyncEncryptionSetup: another dialog is open — deferring setup');
      return 'deferred';
    }

    await this._openDialog();
    return 'opened';
  }

  private async _isEncryptKeyMissing(): Promise<boolean> {
    const provider = this._providerManager.getActiveProvider();
    if (
      !provider ||
      provider.id !== SyncProviderId.SuperSync ||
      !isOperationSyncCapable(provider)
    ) {
      return false;
    }
    const encryptKey = provider.getEncryptKey
      ? await provider.getEncryptKey()
      : undefined;
    return encryptKey === undefined;
  }

  private async _openDialog(): Promise<void> {
    const { DialogEnableEncryptionComponent } =
      await import('./dialog-enable-encryption/dialog-enable-encryption.component');
    // initialSetup: false → the escapable variant with a real Cancel (not the
    // dead-end initialSetup modal, see #8671). Deliberately NOT routed through
    // EncryptionPasswordDialogOpenerService.openEnableEncryptionDialog: that helper
    // forces disableClose:true, which would remove the escapability that is the
    // whole point of these calm nudges. enableEncryption() re-uploads the
    // freshly-synced state encrypted, with its revert-on-failure safety net.
    this._matDialog.open(DialogEnableEncryptionComponent, {
      data: { providerType: 'supersync', initialSetup: false },
    });
  }
}
