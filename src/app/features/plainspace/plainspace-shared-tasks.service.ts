import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { selectEnabledIssueProviders } from '../issue/store/issue-provider.selectors';
import { IssueProviderPlainspace } from '../issue/issue.model';
import { PlainspaceApiService } from '../issue/providers/plainspace/plainspace-api.service';
import { PlainspaceAccountService } from './plainspace-account.service';
import { PlainspaceSharedTask } from './plainspace-shared-task.model';

/**
 * Read-only feed of Plainspace tasks assigned to *other* members of a shared
 * project, for the "Assigned to others" panel. These are never imported as SP
 * tasks and never enter the op-log; they are fetched directly from Plainspace
 * (mock-backed for now). A project is "shared" when it has a bound, enabled
 * `PLAINSPACE` issue provider (`defaultProjectId === projectId`).
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceSharedTasksService {
  private _store = inject(Store);
  private _plainspaceApiService = inject(PlainspaceApiService);
  private _accountService = inject(PlainspaceAccountService);

  othersTasksForProject$(projectId: string): Observable<PlainspaceSharedTask[]> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      map((providers) =>
        providers.find(
          (p): p is IssueProviderPlainspace =>
            p.issueProviderKey === 'PLAINSPACE' && p.defaultProjectId === projectId,
        ),
      ),
      switchMap((provider) => (provider ? this._othersForProvider$(provider) : of([]))),
    );
  }

  private _othersForProvider$(
    provider: IssueProviderPlainspace,
  ): Observable<PlainspaceSharedTask[]> {
    const meId = this._accountService.currentUserId();
    return this._plainspaceApiService.getTasksForSpace$(provider).pipe(
      map((issues) =>
        issues
          .filter((issue) => issue.assigneeId !== null && issue.assigneeId !== meId)
          .map(
            (issue): PlainspaceSharedTask => ({
              id: issue.id,
              title: issue.title,
              isDone: issue.isDone,
              assignee: issue.assignee
                ? {
                    id: issue.assignee.id,
                    name: issue.assignee.name,
                    avatarUrl: issue.assignee.avatarUrl,
                  }
                : null,
              url: issue.url,
            }),
          ),
      ),
    );
  }
}
