import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SearchResultItem } from '../../issue.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceIssue } from './plainspace-issue.model';
import { mapPlainspaceIssueToSearchResult } from './plainspace-issue-map.util';
import { IssueLog } from '../../../../core/log';

/**
 * HTTP access to the real Plainspace integration API (plainspace.org /
 * `Johannesjo/spaces`). Every endpoint lives under `{host}/api/integration` and
 * is authorized with the provider's personal API token (`Authorization: Bearer
 * pat_…`). The server already scopes `/tasks` to the caller, so "mine" is decided
 * server-side — no client-side identity filtering is needed.
 *
 * The wire format (`SPTask`) is mapped to the provider-internal `PlainspaceIssue`
 * here, keeping the real contract isolated to this file. See
 * docs/plainspace-api-extension-plan.md for the endpoint contract.
 *
 * Reads fail soft (empty list / null) so a Plainspace outage never blocks the SP
 * UI; `createSpace$` lets errors propagate so the share flow can report them.
 */
@Injectable({ providedIn: 'root' })
export class PlainspaceApiService {
  private _http = inject(HttpClient);

  /** Verifies the token and returns the account's email + spaces, or null. */
  getMe$(cfg: PlainspaceCfg): Observable<SPMeResponse | null> {
    return this._http
      .get<SPMeResponse>(`${this._base(cfg)}/me`, { headers: this._headers(cfg) })
      .pipe(catchError(() => of(null)));
  }

  /** Tasks assigned to me in this provider's space — imported as SP tasks. */
  getMyTasks$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    return this._http
      .get<SPTasksResponse>(`${this._base(cfg)}/tasks`, { headers: this._headers(cfg) })
      .pipe(
        // /tasks spans all my spaces; keep only this provider's space.
        map((res) => {
          const matched = res.tasks.filter((t) => matchesSpace(t, cfg.spaceId));
          // Diagnostic counts only (no task content) — pinpoints whether the
          // space filter, not the import, is dropping tasks.
          IssueLog.log('Plainspace getMyTasks$', {
            total: res.tasks.length,
            matched: matched.length,
            spaceId: cfg.spaceId,
          });
          return matched.map(mapSPTaskToIssue);
        }),
        catchError(() => of([])),
      );
  }

  /** Unclaimed (unassigned, not-done) tasks in this space — the claim pool. */
  getUnclaimedTasks$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    // Filter to the bound space client-side so `spaceId` works whether it holds
    // the project UUID or the slug (the server `?projectId=` param only accepts
    // the UUID).
    return this._http
      .get<SPTasksResponse>(`${this._base(cfg)}/claimable-tasks`, {
        headers: this._headers(cfg),
      })
      .pipe(
        map((res) =>
          res.tasks.filter((t) => matchesSpace(t, cfg.spaceId)).map(mapSPTaskToIssue),
        ),
        catchError(() => of([])),
      );
  }

  getById$(id: string, cfg: PlainspaceCfg): Observable<PlainspaceIssue | null> {
    return this._http
      .get<SPTaskResponse>(`${this._base(cfg)}/tasks/${encodeURIComponent(id)}`, {
        headers: this._headers(cfg),
      })
      .pipe(
        map((res) => mapSPTaskToIssue(res.task)),
        catchError(() => of(null)),
      );
  }

  /**
   * Self-assigns ("claims") an unclaimed task. Returns the claimed task, or null
   * if it could not be claimed (already taken, offline, …).
   */
  claimTask$(id: string, cfg: PlainspaceCfg): Observable<PlainspaceIssue | null> {
    return this._http
      .post<SPTaskResponse>(
        `${this._base(cfg)}/tasks/${encodeURIComponent(id)}/claim`,
        {},
        { headers: this._headers(cfg) },
      )
      .pipe(
        map((res) => mapSPTaskToIssue(res.task)),
        catchError(() => of(null)),
      );
  }

  /** Pushes a done/undone change back to Plainspace; null on failure. */
  setTaskDone$(
    id: string,
    isDone: boolean,
    cfg: PlainspaceCfg,
  ): Observable<PlainspaceIssue | null> {
    return this._http
      .patch<SPTaskResponse>(
        `${this._base(cfg)}/tasks/${encodeURIComponent(id)}`,
        { done: isDone },
        { headers: this._headers(cfg) },
      )
      .pipe(
        map((res) => mapSPTaskToIssue(res.task)),
        catchError(() => of(null)),
      );
  }

  /** Creates a remote space and returns its id (used by the share flow). */
  createSpace$(title: string, cfg: PlainspaceCfg): Observable<{ id: string }> {
    return this._http
      .post<SPCreateSpaceResponse>(
        `${this._base(cfg)}/spaces`,
        { name: title },
        { headers: this._headers(cfg) },
      )
      .pipe(map((res) => ({ id: res.project.id })));
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

  private _base(cfg: PlainspaceCfg): string {
    return `${cfg.host}/api/integration`;
  }

  private _headers(cfg: PlainspaceCfg): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${cfg.token ?? ''}` });
  }
}

/** The Plainspace integration task DTO (`GET /api/integration/tasks`). */
interface SPTask {
  id: string;
  title: string;
  done: boolean;
  projectId: string;
  projectName: string;
  projectSlug: string;
  listId: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface SPTaskResponse {
  task: SPTask;
}

interface SPTasksResponse {
  tasks: SPTask[];
}

interface SPCreateSpaceResponse {
  project: { id: string };
}

interface SPMeResponse {
  email: string;
  projects: {
    id: string;
    name: string;
    slug: string;
    memberDisplayName: string;
    role: string;
  }[];
}

// `cfg.spaceId` may hold either the Plainspace project UUID or its slug (what
// users see in the space URL, e.g. plainspace.org/<slug>/…), so match both.
const matchesSpace = (t: SPTask, spaceId: string | null | undefined): boolean =>
  !spaceId || t.projectId === spaceId || t.projectSlug === spaceId;

const mapSPTaskToIssue = (t: SPTask): PlainspaceIssue => ({
  id: t.id,
  title: t.title,
  isDone: t.done,
  updatedAt: t.updatedAt,
  url: t.url,
  projectId: t.projectId,
});
