import { inject, Injectable } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncLog } from '../../core/log';

/**
 * When the post-sync SuperSync encryption prompt fires while another dialog is
 * still open (typically the sync-config dialog still playing its close animation
 * right after first-time setup), defer rather than drop the prompt: poll until
 * dialogs clear, up to this bound, then re-check state.
 * See `_promptSuperSyncEncryptionIfNeeded` (#8670 regression).
 */
const ENCRYPTION_PROMPT_DIALOG_WAIT_MS = 8000;
const ENCRYPTION_PROMPT_DIALOG_POLL_MS = 100;

/** What the prompt needs from the sync cycle that owns it (SyncWrapperService). */
export interface SuperSyncEncryptionPromptContext {
  getProviderId: () => Promise<SyncProviderId | null>;
  /** Called when the user finished the setup dialog; the owner re-syncs. */
  onEncryptionEnabled: () => void;
}

/**
 * The post-sync "set up encryption" modal for a fresh SuperSync setup.
 * Moved unchanged out of SyncWrapperService, which still decides when it runs.
 */
@Injectable({
  providedIn: 'root',
})
export class SuperSyncEncryptionPromptService {
  private _providerManager = inject(SyncProviderManager);
  private _matDialog = inject(MatDialog);

  /**
   * Reference to the encryption-required dialog to prevent multiple opens.
   * Uses Record<string, unknown> because dialog component is dynamically imported.
   */

  private _encryptionRequiredDialog?: MatDialogRef<any, Record<string, unknown>>;

  /**
   * Synchronous guard to prevent TOCTOU race in _promptSuperSyncEncryptionIfNeeded.
   * The async import() between checking _encryptionRequiredDialog and opening the dialog
   * creates a window where concurrent calls can both pass the guard.
   */
  private _isOpeningEncryptionDialog = false;

  /**
   * One-shot flag: the legacy post-sync setup modal only fires for the fresh-setup
   * sync (the sync triggered right after the config dialog enables SuperSync).
   * Established/returning unencrypted accounts are nudged by the calm, dismissible
   * SuperSyncEncryptionMigrationBannerService instead, so the per-sync modal must
   * NOT fire for them — otherwise both would prompt at startup. Set by the config
   * dialog via markPromptEncryptionAfterSetupSync(); consumed on the first
   * post-sync prompt evaluation for SuperSync (see _promptSuperSyncEncryptionIfNeeded).
   */
  private _shouldPromptEncryptionAfterSetupSync = false;

  /** True while the one-shot setup prompt is armed and not yet consumed. */
  get isArmedForSetupSync(): boolean {
    return this._shouldPromptEncryptionAfterSetupSync;
  }

  /**
   * Called by the sync config dialog immediately after (re)enabling SuperSync from
   * a disabled state, so the setup encryption modal fires once for that setup sync.
   */
  markPromptAfterSetupSync(): void {
    this._shouldPromptEncryptionAfterSetupSync = true;
  }

  /**
   * After a successful sync, checks if SuperSync is active without encryption.
   * If so, opens the encryption dialog. Data has already been synced, so no data loss.
   */
  async promptIfNeeded(ctx: SuperSyncEncryptionPromptContext): Promise<void> {
    SyncLog.log(
      '_promptSuperSyncEncryptionIfNeeded called, _isOpeningEncryptionDialog=',
      this._isOpeningEncryptionDialog,
      ', _encryptionRequiredDialog=',
      !!this._encryptionRequiredDialog,
      ', openDialogs=',
      this._matDialog.openDialogs.length,
    );
    const providerId = await ctx.getProviderId();
    if (providerId !== SyncProviderId.SuperSync) {
      return;
    }

    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      return;
    }

    // Established/returning unencrypted accounts are owned by the calm migration
    // banner (SuperSyncEncryptionMigrationBannerService); only the fresh-setup sync
    // that armed the flag fires this dead-end modal, so the two never both prompt.
    // Consume the one-shot flag HERE (not at dialog-open) so it can't leak to a
    // later, unrelated sync via one of the early-returns below. A failed setup sync
    // returns HANDLED_ERROR and never reaches this method, so the arming survives
    // and retries on the next successful sync. Tradeoff: if the modal-open is later
    // blocked (another dialog open / TOCTOU guard below), the flag is already spent
    // and this modal won't retry — acceptable because the migration banner catches
    // the still-unencrypted account on the next app start (seq is now > 0).
    // TODO(#8670): once the mandatory-encryption upload guard lands, retire this
    // modal + flag entirely and let the banner own all cohorts.
    if (!this._shouldPromptEncryptionAfterSetupSync) {
      SyncLog.log(
        'Skipping legacy setup encryption modal — migration banner owns established nudge',
      );
      return;
    }
    this._shouldPromptEncryptionAfterSetupSync = false;

    const cfg = (await provider.privateCfg.load()) as
      | { isEncryptionEnabled?: boolean; encryptKey?: string }
      | undefined;
    if (cfg?.isEncryptionEnabled && cfg?.encryptKey) {
      SyncLog.log('SuperSync encryption already enabled, skipping');
      return;
    }

    SyncLog.log(
      'SuperSync encryption not enabled — prompting user, openDialogs=',
      this._matDialog.openDialogs.length,
      ', _isOpeningEncryptionDialog=',
      this._isOpeningEncryptionDialog,
      ', _encryptionRequiredDialog=',
      !!this._encryptionRequiredDialog,
    );

    // If our own encryption prompt is already open or being opened, there is
    // nothing to do — and we must not wait on it below.
    if (this._encryptionRequiredDialog || this._isOpeningEncryptionDialog) {
      SyncLog.log('Encryption prompt already open/opening — skipping');
      return;
    }

    // A transiently-open dialog — typically the sync-config dialog still playing
    // its close animation right after first-time setup — must only DEFER this
    // prompt, never drop it. With the E2EE-mandatory upload guard (GHSA-9v8x) the
    // initial sync finishes almost instantly (upload is skipped until a key
    // exists), so it can now beat the config dialog's close animation; a one-shot
    // skip here then leaves SuperSync enabled with no encryption configured and no
    // prompt shown (#8670 regression). Wait (bounded) for open dialogs to clear,
    // then re-check state before prompting. A competing dialog that is still open
    // after the wait (e.g. an enter-password flow the user is interacting with) is
    // left alone — the next sync re-runs this check.
    if (this._matDialog.openDialogs.length > 0) {
      SyncLog.log('Dialog open — deferring encryption prompt until it closes');
      const waitStart = Date.now();
      while (
        this._matDialog.openDialogs.length > 0 &&
        Date.now() - waitStart < ENCRYPTION_PROMPT_DIALOG_WAIT_MS
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, ENCRYPTION_PROMPT_DIALOG_POLL_MS),
        );
      }
      if (this._matDialog.openDialogs.length > 0) {
        SyncLog.log('Dialog still open after wait — skipping encryption prompt');
        return;
      }
      // Provider/encryption state can change during the wait: the closing dialog
      // may switch providers, disable SuperSync, or configure encryption itself
      // (e.g. an enter-password flow). Re-validate the active provider and its
      // config before prompting — otherwise we could open the disableClose setup
      // dialog for a provider that is no longer active, trapping the user.
      const providerIdAfterWait = await ctx.getProviderId();
      if (providerIdAfterWait !== SyncProviderId.SuperSync) {
        SyncLog.log('Provider changed while waiting — skipping encryption prompt');
        return;
      }
      const providerAfterWait = this._providerManager.getActiveProvider();
      if (!providerAfterWait) {
        return;
      }
      const cfgAfterWait = (await providerAfterWait.privateCfg.load()) as
        | { isEncryptionEnabled?: boolean; encryptKey?: string }
        | undefined;
      if (cfgAfterWait?.isEncryptionEnabled && cfgAfterWait?.encryptKey) {
        SyncLog.log('Encryption enabled while waiting — skipping prompt');
        return;
      }
    }

    if (!this._encryptionRequiredDialog && !this._isOpeningEncryptionDialog) {
      this._isOpeningEncryptionDialog = true;
      SyncLog.log('Opening encryption dialog (guard passed)');
      try {
        const { DialogEnableEncryptionComponent } =
          await import('./dialog-enable-encryption/dialog-enable-encryption.component');

        // Double-check after async import: another call might have opened a dialog
        if (this._encryptionRequiredDialog || this._matDialog.openDialogs.length > 0) {
          SyncLog.log('Dialog appeared during import — aborting');
          return;
        }

        this._encryptionRequiredDialog = this._matDialog.open(
          DialogEnableEncryptionComponent,
          {
            disableClose: true,
            data: { providerType: 'supersync', initialSetup: true },
          },
        );

        this._encryptionRequiredDialog.afterClosed().subscribe((result) => {
          this._encryptionRequiredDialog = undefined;
          if (result?.success) {
            ctx.onEncryptionEnabled();
          }
        });
      } finally {
        this._isOpeningEncryptionDialog = false;
      }
    } else {
      SyncLog.log(
        'Skipping encryption dialog — guard blocked: _encryptionRequiredDialog=',
        !!this._encryptionRequiredDialog,
        ', _isOpeningEncryptionDialog=',
        this._isOpeningEncryptionDialog,
      );
    }
  }
}
