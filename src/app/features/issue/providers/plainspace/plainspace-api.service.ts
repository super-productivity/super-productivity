import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import { SearchResultItem } from '../../issue.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceIssue } from './plainspace-issue.model';
import { mapPlainspaceIssueToSearchResult } from './plainspace-issue-map.util';
import { PLAINSPACE_USE_MOCK } from './plainspace.const';
import { PLAINSPACE_MOCK_ISSUES } from './plainspace-mock-data.const';
import { PlainspaceAccountService } from '../../../plainspace/plainspace-account.service';

/**
 * HTTP access to the Plainspace API. While `PLAINSPACE_USE_MOCK` is true every
 * method serves in-memory mock data, so the provider, the share flow and the
 * claim flow work end-to-end without a live backend. The real HTTP calls are
 * stubbed against an assumed contract (see
 * docs/plainspace-integration-plan.md §10) and isolated here so only this file
 * changes once the real API is known.
 *
 * Ownership model (docs §7): only tasks assigned to me become SP tasks;
 * unclaimed tasks are a read-only pool you claim from; tasks assigned to others
 * are not represented in SP.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceApiService {
  private _http = inject(HttpClient);
  private _accountService = inject(PlainspaceAccountService);

  /** Creates a remote space and returns its id (used by the share flow). */
  createSpace$(title: string, cfg: PlainspaceCfg): Observable<{ id: string }> {
    if (PLAINSPACE_USE_MOCK) {
      return of({ id: `space-${nanoid()}` });
    }
    return this._http.post<{ id: string }>(`${cfg.host}/api/spaces`, { title });
  }

  /** All tasks in the configured space. */
  getTasksForSpace$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    if (PLAINSPACE_USE_MOCK) {
      return of(PLAINSPACE_MOCK_ISSUES);
    }
    return this._http.get<PlainspaceIssue[]>(
      `${cfg.host}/api/spaces/${cfg.spaceId}/tasks`,
    );
  }

  /** Tasks assigned to me — the only tasks imported as first-class SP tasks. */
  getMyTasks$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    const meId = this._accountService.currentUserId();
    return this.getTasksForSpace$(cfg).pipe(
      map((issues) => issues.filter((issue) => !!meId && issue.assigneeId === meId)),
    );
  }

  /** Unclaimed (unassigned, not done) tasks — the read-only claim pool. */
  getUnclaimedTasks$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    return this.getTasksForSpace$(cfg).pipe(
      map((issues) =>
        issues.filter((issue) => issue.assigneeId === null && !issue.isDone),
      ),
    );
  }

  /**
   * Assigns an unclaimed task to the signed-in user ("claim"). In mock mode this
   * mutates the in-memory space data; the real call would POST the assignment.
   */
  claimTask$(issueId: string, cfg: PlainspaceCfg): Observable<PlainspaceIssue | null> {
    if (PLAINSPACE_USE_MOCK) {
      const meId = this._accountService.currentUserId();
      const idx = PLAINSPACE_MOCK_ISSUES.findIndex((i) => i.id === issueId);
      if (idx === -1 || !meId) {
        return of(null);
      }
      const claimed: PlainspaceIssue = {
        ...PLAINSPACE_MOCK_ISSUES[idx],
        assigneeId: meId,
        assignee: { id: meId, name: this._accountService.account()?.displayName ?? 'Me' },
      };
      PLAINSPACE_MOCK_ISSUES[idx] = claimed;
      return of(claimed);
    }
    return this._http.post<PlainspaceIssue>(
      `${cfg.host}/api/spaces/${cfg.spaceId}/tasks/${issueId}/claim`,
      {},
    );
  }

  getById$(id: string, cfg: PlainspaceCfg): Observable<PlainspaceIssue | null> {
    return this.getTasksForSpace$(cfg).pipe(
      map((issues) => issues.find((issue) => issue.id === id) ?? null),
    );
  }

  searchIssues$(query: string, cfg: PlainspaceCfg): Observable<SearchResultItem[]> {
    const term = query.trim().toLowerCase();
    return this.getMyTasks$(cfg).pipe(
      map((issues) =>
        issues
          .filter((issue) => !term || issue.title.toLowerCase().includes(term))
          .map((issue) => mapPlainspaceIssueToSearchResult(issue)),
      ),
    );
  }
}
