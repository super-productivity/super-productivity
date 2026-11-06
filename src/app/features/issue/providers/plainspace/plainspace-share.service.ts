import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, Observable, of } from 'rxjs';
import { first, switchMap } from 'rxjs/operators';
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
import { IS_ELECTRON } from '../../../../app.constants';
import { selectPlainspaceProviderForProject } from '../../store/issue-provider.selectors';
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';
import {
  PlainspaceConnectDialogComponent,
  PlainspaceConnectDialogData,
  PlainspaceConnectDialogResult,
} from '../../../plainspace/connect-dialog/plainspace-connect-dialog.component';
import {
  PlainspaceSpaceChoice,
  PlainspaceSpacePickerDialogComponent,
} from '../../../plainspace/space-picker-dialog/plainspace-space-picker-dialog.component';
import { DIALOG_AUTO_FOCUS_TYPING } from '../../../../util/dialog-auto-focus';

/**
 * Provisions Plainspace sharing for a project: ensures the user is signed in,
 * creates a remote space and registers a bound `PLAINSPACE` issue-provider
 * instance (so tasks assigned to me / unassigned auto-import to the project
 * backlog). Used by the project context menu's "Collaborate on Plainspace"
 * action and the create-project dialog's share toggle. Also hosts
 * `openProjectOnPlainspace` (the header "Open in Plainspace" button) and
 * the invite link (project menu, share success snack), which reuse this
 * service's store/api/snack wiring.
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
      // Sharing is an online action — say so plainly instead of letting the
      // space picker fail later with a confusing "check your token" error.
      if (!isOnline()) {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.OFFLINE });
        return null;
      }
      const connected = await this._ensureConnected(title);
      if (!connected) {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.LOGIN_REQUIRED });
        return null;
      }

      // Signing up just created the account's first Space, named after this
      // project: link it rather than offer to create another.
      const choice: PlainspaceSpaceChoice | null =
        connected === true
          ? await this._chooseSpace()
          : { action: 'link', spaceId: connected.createdSpaceId };
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
      // Resolve the link before showing the snack so its action copies
      // synchronously, inside the click's user activation.
      const inviteUrl = await firstValueFrom(
        this._plainspaceApiService.getSpaceUrl$({ ...cfg, spaceId }),
      );
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.PLAINSPACE.SHARE_SUCCESS,
        ...(inviteUrl
          ? {
              actionStr: T.PLAINSPACE.COPY_INVITE_LINK,
              actionFn: () => this.copyInviteUrl(inviteUrl),
            }
          : {}),
      });
      return spaceId;
    } catch {
      // Log ids only — never user content (project title).
      Log.err('Plainspace: failed to share project', { projectId });
      this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.SHARE_FAILED });
      return null;
    }
  }

  /**
   * Opens the bound Plainspace space's web page (in the system browser under
   * Electron, a new tab otherwise). Resolves the space slug on demand (see
   * {@link PlainspaceApiService.getSpaceUrl$}) and surfaces a snack if it can't be
   * resolved (offline / revoked token). The header button is only shown once a
   * provider is bound; this also re-guards by returning early when none is found.
   */
  async openProjectOnPlainspace(projectId: string): Promise<void> {
    const provider = await firstValueFrom(
      this._store.select(selectPlainspaceProviderForProject(projectId)),
    );
    if (!provider) {
      return;
    }
    const url = await firstValueFrom(this._plainspaceApiService.getSpaceUrl$(provider));
    if (!url) {
      this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.OPEN_FAILED });
      return;
    }
    if (IS_ELECTRON) {
      window.ea.openExternalUrl(url);
    } else {
      // Known web-only limitation: this window.open runs after the /me await, so
      // it's outside the click's transient user-activation. Chrome (~5s window)
      // opens fine; strict blockers (Safari/Firefox) may suppress the tab. We
      // can't detect the block — `noopener` makes window.open return null on
      // success too. Accepted over the fix's cost (a synchronous placeholder tab
      // that also forfeits `noopener`, or a background /me fetch per shared view
      // to pre-resolve the slug). Electron (the primary target) is unaffected.
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  /**
   * The bound space's web URL, or null when there is none or it can't be
   * resolved (offline, rejected token). It doubles as the invite link:
   * Plainspace sends a visitor who isn't a member to the space's join page (or
   * shows a private space's notice), so no separate invite exists. Resolved
   * when the project menu opens so the click can copy synchronously — WebKit
   * only allows a clipboard write inside the click's user activation.
   */
  inviteUrl$(projectId: string): Observable<string | null> {
    return this._store.select(selectPlainspaceProviderForProject(projectId)).pipe(
      first(),
      switchMap((provider) =>
        provider ? this._plainspaceApiService.getSpaceUrl$(provider) : of(null),
      ),
    );
  }

  /** Copies an already resolved invite URL; call it straight from the click. */
  async copyInviteUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this._snackService.open({ type: 'SUCCESS', msg: T.PLAINSPACE.INVITE_LINK_COPIED });
    } catch {
      Log.err('Plainspace: failed to copy invite link');
      this._snackService.open({
        type: 'ERROR',
        msg: T.PLAINSPACE.COPY_INVITE_LINK_FAILED,
      });
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
   * Ensures a Plainspace account is connected, opening the guided connect dialog
   * if not. A stored token that has since gone stale is left to the space
   * picker, which detects it and offers a reconnect. A sign-up names its first
   * Space after the shared project (`title`) and reports it.
   */
  private async _ensureConnected(
    title: string,
  ): Promise<PlainspaceConnectDialogResult | null> {
    if (this._accountService.isLoggedIn()) {
      return true;
    }
    const data: PlainspaceConnectDialogData = {
      host: DEFAULT_PLAINSPACE_CFG.host,
      spaceName: title,
    };
    const connected = await firstValueFrom(
      this._matDialog
        .open(PlainspaceConnectDialogComponent, {
          data,
          autoFocus: DIALOG_AUTO_FOCUS_TYPING,
        })
        .afterClosed(),
    );
    return connected || null;
  }
}
