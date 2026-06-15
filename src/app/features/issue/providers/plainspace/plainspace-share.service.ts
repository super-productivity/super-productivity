import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { nanoid } from 'nanoid';
import { IssueProviderActions } from '../../store/issue-provider.actions';
import { IssueProviderPlainspace } from '../../issue.model';
import { ISSUE_PROVIDER_DEFAULT_COMMON_CFG } from '../../issue.const';
import { PlainspaceApiService } from './plainspace-api.service';
import { DEFAULT_PLAINSPACE_CFG } from './plainspace-cfg-form.const';

/**
 * Provisions Plainspace sharing for a project: creates a remote space and
 * registers a bound `PLAINSPACE` issue-provider instance (so tasks assigned to
 * me / unassigned auto-import to the project backlog). Used by the
 * "Share on Plainspace" toggle in the create-project dialog.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceShareService {
  private _store = inject(Store);
  private _plainspaceApiService = inject(PlainspaceApiService);

  /**
   * @returns the created space id, or null if sharing could not be provisioned.
   */
  async shareProjectOnPlainspace(
    projectId: string,
    title: string,
  ): Promise<string | null> {
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
  }
}
