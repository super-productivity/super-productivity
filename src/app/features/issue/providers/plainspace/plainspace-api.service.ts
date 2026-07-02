import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SearchResultItem } from '../../issue.model';
import { PlainspaceCfg } from './plainspace.model';
import { PlainspaceIssue } from './plainspace-issue.model';
import { mapPlainspaceIssueToSearchResult } from './plainspace-issue-map.util';

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

  /**
   * The spaces (Plainspace projects) the token can access — used to let the user
   * link an existing space instead of creating a new one. Returns `null` when the
   * request fails (offline / invalid token) so callers can tell a genuine "no
   * spaces yet" (empty list) apart from an error.
   */
  getSpaces$(cfg: PlainspaceCfg): Observable<PlainspaceSpace[] | null> {
    return this.getMe$(cfg).pipe(
      map((me) =>
        me ? me.projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })) : null,
      ),
    );
  }

  /**
   * The human-facing web URL of the bound space (`{host}/{slug}`), so the project
   * menu can open it. `cfg.spaceId` holds the project UUID (or, if the user pasted
   * it, the slug), but the web app addresses spaces by slug — task URLs are
   * `{origin}/{slug}/item/{id}` — so resolve the canonical slug via `/me`. Returns
   * null when offline, the token is invalid, or the space is no longer accessible.
   */
  getSpaceUrl$(cfg: PlainspaceCfg): Observable<string | null> {
    if (!cfg.host || !cfg.spaceId) {
      return of(null);
    }
    return this.getMe$(cfg).pipe(
      map((me) => {
        // Guard the body shape defensively: a 200 with a malformed payload
        // (non-array `projects`) is NOT caught by getMe$'s HTTP catchError and
        // would otherwise throw here — becoming an unhandled rejection with no
        // OPEN_FAILED snack. Mirrors the Array.isArray guard in getMyTasks$.
        const projects = me && Array.isArray(me.projects) ? me.projects : [];
        const space = projects.find(
          (p) => p.id === cfg.spaceId || p.slug === cfg.spaceId,
        );
        // Require a non-empty slug: `space` with a blank slug would build the
        // host root ({host}/) — send OPEN_FAILED instead of the wrong page.
        return space?.slug ? `${cfg.host}/${space.slug}` : null;
      }),
    );
  }

  /** Tasks assigned to me in this provider's space — imported as SP tasks. */
  getMyTasks$(cfg: PlainspaceCfg): Observable<PlainspaceIssue[]> {
    return this._http
      .get<SPTasksResponse>(`${this._base(cfg)}/tasks`, { headers: this._headers(cfg) })
      .pipe(
        // /tasks spans all my spaces; keep only this provider's space.
        map((res) =>
          (Array.isArray(res?.tasks) ? res.tasks : [])
            .filter((t) => matchesSpace(t, cfg.spaceId))
            .map(mapSPTaskToIssue),
        ),
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
          (Array.isArray(res?.tasks) ? res.tasks : [])
            .filter((t) => matchesSpace(t, cfg.spaceId))
            .map(mapSPTaskToIssue),
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

  /**
   * Pushes a field change back to Plainspace — done state, title, and/or
   * scheduled time (`scheduledAt`) — in a single PATCH; null on failure.
   * `scheduledAt` is an ISO instant, or null to unschedule. Used by the
   * two-way-sync adapter.
   */
  patchTask$(
    id: string,
    fields: { done?: boolean; title?: string; scheduledAt?: string | null },
    cfg: PlainspaceCfg,
  ): Observable<PlainspaceIssue | null> {
    return this._http
      .patch<SPTaskResponse>(
        `${this._base(cfg)}/tasks/${encodeURIComponent(id)}`,
        fields,
        { headers: this._headers(cfg) },
      )
      .pipe(
        map((res) => mapSPTaskToIssue(res.task)),
        catchError(() => of(null)),
      );
  }

  /**
   * Creates a new task in the bound space (`cfg.spaceId`) and returns it mapped
   * to a `PlainspaceIssue`. The symmetric twin of `claimTask$`: it lets a task
   * added to a Plainspace-backed project appear for the team. Used by the
   * two-way-sync adapter's `createIssue`. Errors propagate (unlike the reads and
   * like `createSpace$`) so the auto-create effect can surface a failure snack
   * instead of silently dropping the task.
   */
  createTask$(title: string, cfg: PlainspaceCfg): Observable<PlainspaceIssue> {
    return this._http
      .post<SPTaskResponse>(
        `${this._base(cfg)}/tasks`,
        { spaceId: cfg.spaceId, title },
        { headers: this._headers(cfg) },
      )
      .pipe(map((res) => mapSPTaskToIssue(res.task)));
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

/** A Plainspace space (project) the connected account can bind a provider to. */
export interface PlainspaceSpace {
  id: string;
  name: string;
  slug: string;
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
  // ISO instant the task is scheduled for, or null when unscheduled. For
  // recurring items this is the next occurrence (server-advanced). See
  // docs/plainspace-api-extension-plan.md §scheduling.
  scheduledAt: string | null;
  // Whether the task repeats in Plainspace (the cadence stays server-side).
  isRecurring: boolean;
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
  // Normalize to a canonical UTC ISO instant on read. The two-way-sync baseline
  // and push both compare `scheduledAt` by exact string, and the push side emits
  // `new Date(ms).toISOString()` — so an equivalent-but-differently-formatted
  // server value (offset vs Z, ms precision) would otherwise read as a remote
  // change and silently drop the user's reschedule.
  scheduledAt: t.scheduledAt ? new Date(t.scheduledAt).toISOString() : null,
  isRecurring: !!t.isRecurring,
});
