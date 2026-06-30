import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { IssueProviderActions } from '../../store/issue-provider.actions';
import { IssueProviderPlainspace } from '../../issue.model';
import { ISSUE_PROVIDER_DEFAULT_COMMON_CFG } from '../../issue.const';
import { PlainspaceApiService } from './plainspace-api.service';
import { PlainspaceCfg } from './plainspace.model';
import { DEFAULT_PLAINSPACE_CFG } from './plainspace-cfg-form.const';
import { SnackService } from '../../../../core/snack/snack.service';
import { Log } from '../../../../core/log';
import { T } from '../../../../t.const';
import { isOnline } from '../../../../util/is-online';
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';
import { PlainspaceConnectDialogComponent } from '../../../plainspace/connect-dialog/plainspace-connect-dialog.component';
import {
  PlainspaceSpaceChoice,
  PlainspaceSpacePickerDialogComponent,
} from '../../../plainspace/space-picker-dialog/plainspace-space-picker-dialog.component';

/**
 * Provisions Plainspace sharing for a project: ensures the user is signed in,
 * creates a remote space and registers a bound `PLAINSPACE` issue-provider
 * instance (so tasks assigned to me / unassigned auto-import to the project
 * backlog). Used by the "Share on Plainspace" toggle in the create-project
 * dialog.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceShareService {
  private _store = inject(Store);
  private _plainspaceApiService = inject(PlainspaceApiService);
  private _accountService = inject(PlainspaceAccountService);
  private _snackService = inject(SnackService);
  private _matDialog = inject(MatDialog);

  /**
   * Self-contained (never rejects) so it is safe to fire-and-forget from the
   * create-project dialog. Prompts for sign-in if needed, then lets the user
   * create a new space or link an existing one (so tasks already assigned to
   * them import). On failure (or if the user cancels) it surfaces a snack /
   * returns null.
   *
   * @returns the bound space id, or null if sharing could not be provisioned.
   */
  async shareProjectOnPlainspace(
    projectId: string,
    title: string,
  ): Promise<string | null> {
    try {
      const conn = await this._ensureUsableAccount();
      if (conn === 'offline') {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.OFFLINE });
        return null;
      }
      if (conn === 'cancelled') {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.LOGIN_REQUIRED });
        return null;
      }

      const choice = await this._chooseSpace();
      if (!choice) {
        // User cancelled the space picker — nothing to provision.
        return null;
      }

      const account = this._accountService.account();
      const cfg: PlainspaceCfg = {
        ...DEFAULT_PLAINSPACE_CFG,
        host: account?.host ?? DEFAULT_PLAINSPACE_CFG.host,
        token: account?.token ?? null,
      };

      const spaceId =
        choice.action === 'create'
          ? (await firstValueFrom(this._plainspaceApiService.createSpace$(title, cfg)))
              ?.id
          : choice.spaceId;
      if (!spaceId) {
        return null;
      }

      const issueProvider: IssueProviderPlainspace = {
        ...ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
        ...DEFAULT_PLAINSPACE_CFG,
        id: nanoid(),
        issueProviderKey: 'PLAINSPACE',
        isEnabled: true,
        defaultProjectId: projectId,
        isAutoAddToBacklog: true,
        host: cfg.host,
        token: cfg.token,
        spaceId,
      };
      this._store.dispatch(IssueProviderActions.addIssueProvider({ issueProvider }));
      this._snackService.open({ type: 'SUCCESS', msg: T.PLAINSPACE.SHARE_SUCCESS });
      return spaceId;
    } catch {
      // Log ids only — never user content (project title).
      Log.err('Plainspace: failed to share project', { projectId });
      this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.SHARE_FAILED });
      return null;
    }
  }

  /**
   * Opens the space picker (create new vs link existing). Returns the chosen
   * action, or null if the user cancelled.
   */
  private async _chooseSpace(): Promise<PlainspaceSpaceChoice | null> {
    const choice = await firstValueFrom(
      this._matDialog.open(PlainspaceSpacePickerDialogComponent).afterClosed(),
    );
    return choice ?? null;
  }

  /**
   * Makes sure we have a *usable* connection before opening the space picker —
   * the picker only fails with a confusing "check your token" error otherwise.
   *
   * - `offline`: we can't reach Plainspace at all; say so plainly.
   * - revalidate a stored token: a stale one (revoked, or created on another
   *   device and never valid here) routes to the guided connect dialog to
   *   re-auth, instead of dead-ending in the picker.
   * - no/invalid account: open the guided connect dialog (intro + token steps).
   *
   * Returns `ready` once usable, `cancelled` if the user backed out of connect.
   */
  private async _ensureUsableAccount(): Promise<'ready' | 'offline' | 'cancelled'> {
    if (!this._isOnline()) {
      return 'offline';
    }
    if (this._accountService.isLoggedIn() && (await this._accountService.revalidate())) {
      return 'ready';
    }
    const connected = await firstValueFrom(
      this._matDialog
        .open(PlainspaceConnectDialogComponent, {
          data: { host: this._accountService.host() ?? DEFAULT_PLAINSPACE_CFG.host },
        })
        .afterClosed(),
    );
    return connected === true ? 'ready' : 'cancelled';
  }

  // Seam over the `isOnline()` util so the offline path is unit-testable
  // (navigator.onLine is not reliably overridable in the test runner).
  private _isOnline(): boolean {
    return isOnline();
  }
}
