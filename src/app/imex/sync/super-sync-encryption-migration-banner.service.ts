import { inject, Injectable } from '@angular/core';
import { isCryptoSubtleAvailable } from '@sp/sync-core';
import { BannerService } from '../../core/banner/banner.service';
import { BannerId } from '../../core/banner/banner.model';
import { LS } from '../../core/persistence/storage-keys.const';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { devError } from '../../util/dev-error';
import { T } from '../../t.const';
import { SuperSyncEncryptionSetupService } from './super-sync-encryption-setup.service';

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
  private readonly _encryptionSetupService = inject(SuperSyncEncryptionSetupService);

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
    // case is caught safely at click time by the shared setup flow, whose preflight
    // sync hits DecryptNoPasswordError → HANDLED_ERROR and defers to the
    // enter-password flow rather than offering a destructive re-encrypt.
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
    // The shared setup flow guards the destructive delete-and-reupload dialog:
    // fresh preflight sync (a peer-encrypted server defers to the enter-password
    // flow), post-sync eligibility re-check, and no dialog stacking. The banner's
    // own full predicate is re-used as the re-check so a mid-interaction change
    // (e.g. the account turned out to be encrypted) shows an info snack instead
    // of a destructive re-encrypt under a new key.
    const outcome = await this._encryptionSetupService.syncThenOfferSetup({
      isStillNeeded: () => this._isMigrationNeeded(),
    });
    if (outcome === 'opened') {
      // Reached the migration decision: snooze so backing out of the dialog
      // doesn't re-nag next session (a successful enable stops detection anyway).
      this._snooze();
    }
    // 'deferred' (preflight failed / another dialog open) intentionally does NOT
    // snooze, so the nudge returns next session — the user asked to encrypt but
    // never reached the decision.
  }

  private _snooze(): void {
    localStorage.setItem(
      LS.SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL,
      (Date.now() + SNOOZE_MS).toString(),
    );
  }
}
