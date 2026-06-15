import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { nanoid } from 'nanoid';
import { SearchResultItem } from '../../issue.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceIssue } from './plainspace-issue.model';
import { mapPlainspaceIssueToSearchResult } from './plainspace-issue-map.util';
import { PLAINSPACE_MOCK_CURRENT_USER_ID, PLAINSPACE_USE_MOCK } from './plainspace.const';
import { PLAINSPACE_MOCK_ISSUES } from './plainspace-mock-data.const';

/**
 * HTTP access to the Plainspace API. While `PLAINSPACE_USE_MOCK` is true every
 * method serves in-memory mock data, so the provider and the "Share on
 * Plainspace" flow work end-to-end without a live backend. The real HTTP calls
 * are stubbed against an assumed contract (see
 * docs/plainspace-integration-plan.md §10) and isolated here so only this file
 * changes once the real API is known.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceApiService {
  private _http = inject(HttpClient);

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

  /**
   * Tasks that are valid to import as SP tasks: assigned to me OR unassigned.
   * Tasks assigned to others are intentionally excluded here — they are shown
   * read-only by the "assigned to others" panel and never imported.
   */
  getMyAndUnassignedTasks$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    return this.getTasksForSpace$(cfg).pipe(
      map((issues) =>
        issues.filter(
          (issue) =>
            issue.assigneeId === null ||
            issue.assigneeId === PLAINSPACE_MOCK_CURRENT_USER_ID,
        ),
      ),
    );
  }

  getById$(id: string, cfg: PlainspaceCfg): Observable<PlainspaceIssue | null> {
    return this.getTasksForSpace$(cfg).pipe(
      map((issues) => issues.find((issue) => issue.id === id) ?? null),
    );
  }

  searchIssues$(query: string, cfg: PlainspaceCfg): Observable<SearchResultItem[]> {
    const term = query.trim().toLowerCase();
    return this.getMyAndUnassignedTasks$(cfg).pipe(
      map((issues) =>
        issues
          .filter((issue) => !term || issue.title.toLowerCase().includes(term))
          .map((issue) => mapPlainspaceIssueToSearchResult(issue)),
      ),
    );
  }
}
