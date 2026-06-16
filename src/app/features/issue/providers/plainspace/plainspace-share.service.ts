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
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';
import { DialogPromptComponent } from '../../../../ui/dialog-prompt/dialog-prompt.component';

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
   * create-project dialog. Prompts for sign-in if needed. On failure (or if the
   * user declines sign-in) it surfaces a snack and returns null.
   *
   * @returns the created space id, or null if sharing could not be provisioned.
   */
  async shareProjectOnPlainspace(
    projectId: string,
    title: string,
  ): Promise<string | null> {
    try {
      if (!(await this._ensureConnected())) {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.LOGIN_REQUIRED });
        return null;
      }

      const account = this._accountService.account();
      const cfg: PlainspaceCfg = {
        ...DEFAULT_PLAINSPACE_CFG,
        host: account?.host ?? DEFAULT_PLAINSPACE_CFG.host,
        token: account?.token ?? null,
      };
      const space = await firstValueFrom(
        this._plainspaceApiService.createSpace$(title, cfg),
      );
      if (!space?.id) {
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
        spaceId: space.id,
      };
      this._store.dispatch(IssueProviderActions.addIssueProvider({ issueProvider }));
      return space.id;
    } catch {
      // Log ids only — never user content (project title).
      Log.err('Plainspace: failed to share project', { projectId });
      this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.SHARE_FAILED });
      return null;
    }
  }

  /**
   * Ensures a Plainspace account is connected, prompting for an API token (PAT)
   * if not. The token is validated against the host before it is accepted.
   */
  private async _ensureConnected(): Promise<boolean> {
    if (this._accountService.isLoggedIn()) {
      return true;
    }
    const token: string | undefined = await firstValueFrom(
      this._matDialog
        .open(DialogPromptComponent, {
          data: { placeholder: T.PLAINSPACE.LOGIN_PROMPT },
        })
        .afterClosed(),
    );
    if (!token?.trim()) {
      return false;
    }
    return this._accountService.connect(token.trim());
  }
}
