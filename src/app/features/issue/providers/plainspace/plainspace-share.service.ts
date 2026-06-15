import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { IssueProviderActions } from '../../store/issue-provider.actions';
import { IssueProviderPlainspace } from '../../issue.model';
import { ISSUE_PROVIDER_DEFAULT_COMMON_CFG } from '../../issue.const';
import { PlainspaceApiService } from './plainspace-api.service';
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
      if (!(await this._ensureLoggedIn())) {
        this._snackService.open({ type: 'ERROR', msg: T.PLAINSPACE.LOGIN_REQUIRED });
        return null;
      }

      const cfg = { ...DEFAULT_PLAINSPACE_CFG };
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
   * Returns true if a Plainspace account is available, prompting a (mock)
   * sign-in if not. The real flow would do an OAuth/token exchange instead of a
   * name prompt.
   */
  private async _ensureLoggedIn(): Promise<boolean> {
    if (this._accountService.isLoggedIn()) {
      return true;
    }
    const displayName: string | undefined = await firstValueFrom(
      this._matDialog
        .open(DialogPromptComponent, {
          data: { placeholder: T.PLAINSPACE.LOGIN_PROMPT },
        })
        .afterClosed(),
    );
    if (!displayName?.trim()) {
      return false;
    }
    this._accountService.login(displayName);
    return true;
  }
}
