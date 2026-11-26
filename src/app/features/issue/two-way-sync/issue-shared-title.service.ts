import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Task } from '../../tasks/task.model';
import { IssueProviderService } from '../issue-provider.service';
import { IssueProviderKey } from '../issue.model';
import { IssueSyncAdapterResolverService } from './issue-sync-adapter-resolver.service';

/**
 * The title a linked task last agreed on with its provider (its baseline), when
 * its title syncs both ways (Plainspace; CalDAV when set to). Collaborators may
 * have written it, so a local title edit applies short syntax only to words not
 * in it: a "#urgent" or "@fri" someone else wrote stays text for everyone
 * instead of becoming my tag or date and being stripped from the shared title.
 */
@Injectable({ providedIn: 'root' })
export class IssueSharedTitleService {
  private readonly _adapterResolver = inject(IssueSyncAdapterResolverService);
  private readonly _issueProviderService = inject(IssueProviderService);

  async getSharedTitle(task: Task): Promise<string | undefined> {
    const { issueType, issueProviderId, issueId } = task;
    if (!issueType || !issueProviderId || !issueId) {
      return undefined;
    }
    const adapter = this._adapterResolver.getAdapter(issueType);
    const mapping = adapter?.getFieldMappings().find((m) => m.taskField === 'title');
    const sharedTitle = mapping && task.issueLastSyncedValues?.[mapping.issueField];
    if (!adapter || !mapping || typeof sharedTitle !== 'string') {
      return undefined;
    }
    const cfg = await firstValueFrom(
      this._issueProviderService.getCfgOnce$(
        issueProviderId,
        issueType as IssueProviderKey,
      ),
    );
    const direction =
      adapter.getSyncConfig(cfg)[mapping.taskField] ?? mapping.defaultDirection;
    return direction === 'both' ? sharedTitle : undefined;
  }
}
