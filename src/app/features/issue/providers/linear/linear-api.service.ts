import { Injectable, inject } from '@angular/core';
import {
  HttpClient,
  HttpEventType,
  HttpHeaders,
  HttpRequest,
  HttpResponse,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, filter, map } from 'rxjs/operators';
import { LinearCfg } from './linear.model';
import { LinearAttachment, LinearIssue, LinearIssueReduced } from './linear-issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';
import { LINEAR_TYPE } from '../../issue.const';
import { IssueLog } from '../../../../core/log';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

interface LinearGraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface LinearRawIssueReduced {
  id: string;
  identifier: string;
  number: number;
  title: string;
  updatedAt: string;
  url: string;
  state: { name: string; type: string };
}

interface LinearRawIssue extends LinearRawIssueReduced {
  description?: string;
  priority: number;
  createdAt: string;
  completedAt?: string;
  canceledAt?: string;
  dueDate?: string;
  assignee?: { id: string; name: string; email: string; avatarUrl: string };
  creator: { id: string; name: string };
  team: { id: string; name: string; key: string };
  labels?: {
    nodes: Array<{ id: string; name: string; color: string }>;
  };
  comments?: {
    nodes: Array<{
      id: string;
      body: string;
      createdAt: string;
      user?: { id: string; name: string; avatarUrl: string };
    }>;
  };
  attachments?: { nodes: LinearAttachment[] };
}

@Injectable({
  providedIn: 'root',
})
export class LinearApiService {
  private _snackService = inject(SnackService);
  private _http = inject(HttpClient);

  getById$(issueId: string, cfg: LinearCfg): Observable<LinearIssue> {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          number
          title
          description
          priority
          createdAt
          updatedAt
          completedAt
          canceledAt
          dueDate
          url
          state {
            id
            name
            type
          }
          team {
            id
            name
            key
          }
          assignee {
            id
            name
            email
            avatarUrl
          }
          creator {
            id
            name
          }
          labels(first: 50) {
            nodes {
              id
              name
              color
            }
          }
          comments(first: 50) {
            nodes {
              id
              body
              createdAt
              user {
                id
                name
                avatarUrl
              }
            }
          }
          attachments {
            nodes {
              id
              sourceType
              title
              url
            }
          }
        }
      }
    `;

    return this._sendRequest$<LinearIssue>({
      query: this._normalizeQuery(query),
      variables: { id: issueId },
      transform: (res: LinearGraphQLResponse<{ issue: LinearRawIssue }>) => {
        if (res?.data?.issue) {
          return this._mapLinearIssueToIssue(res.data.issue);
        }
        throw new Error('No issue data returned');
      },
      cfg,
    });
  }

  /**
   * Search assigned issues with optional teamId and projectId filters.
   * @param searchTerm - Search string for title/identifier filtering (client-side)
   * @param cfg - Linear config
   * @param opts - Optional filters: teamId, projectId
   */
  searchIssues$(
    searchTerm: string,
    cfg: LinearCfg,
    opts?: { teamId?: string; projectId?: string },
  ): Observable<LinearIssueReduced[]> {
    const query = `
      query SearchIssues($first: Int!, $team: TeamFilter, $project: NullableProjectFilter) {
        viewer {
          assignedIssues(
            first: $first,
            filter: {
              state: { type: { in: ["backlog", "unstarted", "started"] } },
              team: $team,
              project: $project
            }
          ) {
            nodes {
              id
              identifier
              number
              title
              updatedAt
              url
              state {
                id
                name
                type
              }
            }
          }
        }
      }
    `;

    // Build filter objects for variables, only include if provided
    const variables: Record<string, unknown> = { first: 50 };
    if (opts?.teamId) {
      variables.team = { id: { eq: opts.teamId } };
    }
    if (opts?.projectId) {
      variables.project = { id: { eq: opts.projectId } };
    }

    return this._sendRequest$<LinearIssueReduced[]>({
      query: this._normalizeQuery(query),
      variables,
      transform: (
        res: LinearGraphQLResponse<{
          viewer: { assignedIssues: { nodes: LinearRawIssueReduced[] } };
        }>,
      ) => {
        let issues = res?.data?.viewer?.assignedIssues?.nodes || [];

        if (searchTerm.trim()) {
          const lowerSearchTerm = searchTerm.toLowerCase();
          issues = issues.filter(
            (issue) =>
              issue.title.toLowerCase().includes(lowerSearchTerm) ||
              issue.identifier.toLowerCase().includes(lowerSearchTerm),
          );
        }

        return issues.map((issue) => this._mapLinearIssueToIssueReduced(issue));
      },
      cfg,
    });
  }

  testConnection(cfg: LinearCfg): Observable<boolean> {
    const query = `
      query GetViewer {
        viewer {
          id
          name
        }
      }
    `;

    return this._sendRequest$<boolean>({
      query: this._normalizeQuery(query),
      variables: {},
      transform: () => true,
      cfg,
    }).pipe(
      catchError((error) => {
        IssueLog.err('LINEAR_CONNECTION_TEST', error);
        throw error;
      }),
    );
  }

  private _sendRequest$<T>({
    query,
    variables,
    transform,
    cfg,
  }: {
    query: string;
    variables: Record<string, unknown>;
    transform?: (response: any) => T;
    cfg: LinearCfg;
  }): Observable<T> {
    const headers = new HttpHeaders({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Authorization: cfg.apiKey || '',
    });

    const body = {
      query,
      variables,
    };

    const req = new HttpRequest('POST', LINEAR_API_URL, body, {
      headers,
      reportProgress: false,
    });

    return this._http.request(req).pipe(
      // Filter out HttpEventType.Sent (type: 0) events to only process actual responses
      filter(
        (res): res is HttpResponse<LinearGraphQLResponse> =>
          res.type === HttpEventType.Response,
      ),
      map((res) => (res.body ? res.body : ({} as LinearGraphQLResponse))),
      map((res) => {
        // Check for GraphQL errors in response
        if (res?.errors?.length) {
          IssueLog.err('LINEAR_GRAPHQL_ERROR', res.errors);
          throw new Error(res.errors[0].message || 'GraphQL error');
        }
        return res;
      }),
      map((res) => {
        return transform ? transform(res) : (res as unknown as T);
      }),
      catchError((err) =>
        handleIssueProviderHttpError$(LINEAR_TYPE, this._snackService, err),
      ),
    ) as Observable<T>;
  }

  private _normalizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }

  private _mapLinearIssueToIssueReduced(
    issue: LinearRawIssueReduced,
  ): LinearIssueReduced {
    return {
      id: issue.id,
      identifier: issue.identifier,
      number: issue.number,
      title: issue.title,
      state: {
        name: issue.state.name,
        type: issue.state.type,
      },
      updatedAt: issue.updatedAt,
      url: issue.url,
    };
  }

  private _mapLinearIssueToIssue(issue: LinearRawIssue): LinearIssue {
    return {
      id: issue.id,
      identifier: issue.identifier,
      number: issue.number,
      title: issue.title,
      state: {
        name: issue.state.name,
        type: issue.state.type,
      },
      updatedAt: issue.updatedAt,
      url: issue.url,
      description: issue.description || undefined,
      priority: issue.priority,
      createdAt: issue.createdAt,
      completedAt: issue.completedAt || undefined,
      canceledAt: issue.canceledAt || undefined,
      dueDate: issue.dueDate || undefined,
      assignee: issue.assignee
        ? {
            id: issue.assignee.id,
            name: issue.assignee.name,
            email: issue.assignee.email,
            avatarUrl: issue.assignee.avatarUrl,
          }
        : undefined,
      creator: {
        id: issue.creator.id,
        name: issue.creator.name,
      },
      team: {
        id: issue.team.id,
        name: issue.team.name,
        key: issue.team.key,
      },
      labels: (issue.labels?.nodes || []).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      comments: (issue.comments?.nodes || [])
        .filter((comment) => !!comment.user)
        .map((comment) => ({
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt,
          user: {
            id: comment.user!.id,
            name: comment.user!.name,
            avatarUrl: comment.user!.avatarUrl,
          },
        })),
      attachments: (issue.attachments?.nodes || []) as LinearAttachment[],
    };
  }
}
