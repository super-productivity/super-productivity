import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError, filter, map } from 'rxjs/operators';
import { LinearCfg } from './linear.model';
import { LinearAttachment, LinearIssue, LinearIssueReduced } from './linear-issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { handleIssueProviderHttpError$ } from '../../handle-issue-provider-http-error';
import { LINEAR_TYPE } from '../../issue.const';
import { IssueLog } from '../../../../core/log';

const LINEAR_API_URL = 'https://api.linear.app/graphql';

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

    return this._sendRequest$({
      query: this._normalizeQuery(query),
      variables: { id: issueId },
      transform: (res: any) => {
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
    const variables: any = { first: 50 };
    if (opts?.teamId) {
      variables.team = { id: { eq: opts.teamId } };
    }
    if (opts?.projectId) {
      variables.project = { id: { eq: opts.projectId } };
    }

    return this._sendRequest$({
      query: this._normalizeQuery(query),
      variables,
      transform: (res: any) => {
        let issues = res?.data?.viewer?.assignedIssues?.nodes || [];

        if (searchTerm.trim()) {
          const lowerSearchTerm = searchTerm.toLowerCase();
          issues = issues.filter(
            (issue: any) =>
              issue.title.toLowerCase().includes(lowerSearchTerm) ||
              issue.identifier.toLowerCase().includes(lowerSearchTerm),
          );
        }

        return issues.map((issue: any) => this._mapLinearIssueToIssueReduced(issue));
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

    return this._sendRequest$({
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

  private _sendRequest$({
    query,
    variables,
    transform,
    cfg,
  }: {
    query: string;
    variables: Record<string, any>;
    transform?: (response: any) => any;
    cfg: LinearCfg;
  }): Observable<any> {
    const headers = new HttpHeaders({
      // eslint-disable-next-line @typescript-eslint/naming-convention
      'Content-Type': 'application/json',
      Authorization: cfg.apiKey || '',
    });

    const body = {
      query,
      variables,
    };

    const allArgs = [
      body,
      {
        headers,
        reportProgress: false,
        observe: 'response',
      },
    ];

    const req = new HttpRequest('POST' as any, LINEAR_API_URL, ...(allArgs as any));

    return this._http.request(req).pipe(
      // Filter out HttpEventType.Sent (type: 0) events to only process actual responses
      filter((res: any) => !(res === Object(res) && res.type === 0)),
      map((res: any) => (res && res.body ? res.body : res)),
      map((res: any) => {
        // Check for GraphQL errors in response
        if (res?.errors?.length) {
          IssueLog.err('LINEAR_GRAPHQL_ERROR', res.errors);
          throw new Error(res.errors[0].message || 'GraphQL error');
        }
        return res;
      }),
      map((res: any) => {
        return transform ? transform(res) : res;
      }),
      catchError((err) =>
        handleIssueProviderHttpError$(LINEAR_TYPE, this._snackService, err),
      ),
    );
  }

  private _normalizeQuery(query: string): string {
    return query.replace(/\s+/g, ' ').trim();
  }

  private _mapLinearIssueToIssueReduced(issue: any): LinearIssueReduced {
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

  private _mapLinearIssueToIssue(issue: any): LinearIssue {
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
      labels: (issue.labels?.nodes || []).map((label: any) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
      comments: (issue.comments?.nodes || []).map((comment: any) => ({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        user: comment.user
          ? {
              id: comment.user.id,
              name: comment.user.name,
              avatarUrl: comment.user.avatarUrl,
            }
          : undefined,
      })),
      attachments: (issue.attachments?.nodes || []) as LinearAttachment[],
    };
  }
}
