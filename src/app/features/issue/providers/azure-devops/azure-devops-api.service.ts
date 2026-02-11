import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AzureDevOpsCfg } from './azure-devops.model';
import { AzureDevOpsIssueReduced } from './azure-devops-issue/azure-devops-issue.model';

// Azure DevOps API response interfaces
interface AzureDevOpsUser {
  id: string;
  displayName: string;
}

interface AzureDevOpsConnectionData {
  authenticatedUser: AzureDevOpsUser;
}

interface AzureDevOpsWorkItemReference {
  id: number;
}

interface AzureDevOpsWiqlResponse {
  workItems: AzureDevOpsWorkItemReference[];
}

// Azure DevOps work item fields use dotted names like 'System.Title'
// Using index signature to avoid ESLint naming convention errors

type AzureDevOpsWorkItemFields = Record<string, unknown> & {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  'System.AssignedTo'?: { displayName: string };
};

interface AzureDevOpsWorkItemLinks {
  html?: { href: string };
}

interface AzureDevOpsWorkItem {
  id: number;
  fields: AzureDevOpsWorkItemFields;
  _links?: AzureDevOpsWorkItemLinks;
}

interface AzureDevOpsWorkItemsResponse {
  value: AzureDevOpsWorkItem[];
}

@Injectable({
  providedIn: 'root',
})
export class AzureDevOpsApiService {
  private _http = inject(HttpClient);

  getCurrentUser$(cfg: AzureDevOpsCfg): Observable<AzureDevOpsUser> {
    return this._http
      .get<AzureDevOpsConnectionData>(
        `${this._getBaseUrl(cfg)}/_apis/connectionData?api-version=5.1-preview`,
        { headers: this._getHeaders(cfg) },
      )
      .pipe(map((res) => res.authenticatedUser));
  }

  searchIssues$(
    searchTerm: string,
    cfg: AzureDevOpsCfg,
  ): Observable<AzureDevOpsIssueReduced[]> {
    const sanitizedSearchTerm = searchTerm.replace(/'/g, "''");
    const sanitizedProject = (cfg.project || '').replace(/'/g, "''");
    // prettier-ignore
    let query = `Select [System.Id] From WorkItems Where [System.Title] Contains '${sanitizedSearchTerm}' ` +
      `AND [System.TeamProject] = '${sanitizedProject}'`;
    if (sanitizedSearchTerm.match(/^\d+$/)) {
      // prettier-ignore
      query = `Select [System.Id] From WorkItems Where ([System.Title] Contains '${sanitizedSearchTerm}' ` +
        `OR [System.Id] = ${sanitizedSearchTerm}) AND [System.TeamProject] = '${sanitizedProject}'`;
    }

    return this._http
      .post<AzureDevOpsWiqlResponse>(
        `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/wiql?api-version=6.0`,
        { query },
        { headers: this._getHeaders(cfg).set('Content-Type', 'application/json') },
      )
      .pipe(
        switchMap((res) => this._mapIssues(res, cfg)),
        catchError((error) => {
          return throwError(error);
        }),
      );
  }

  getNewIssuesToAddToBacklog$(
    cfg: AzureDevOpsCfg,
  ): Observable<AzureDevOpsIssueReduced[]> {
    const sanitizedProject = (cfg.project || '').replace(/'/g, "''");
    // prettier-ignore
    let query = `Select [System.Id] From WorkItems Where [System.TeamProject] = '${sanitizedProject}' ` +
      `AND [System.State] <> 'Closed' AND [System.State] <> 'Done' AND [System.State] <> 'Removed'`;
    if (cfg.scope === 'assigned-to-me') {
      query += ` AND [System.AssignedTo] = @Me`;
    } else if (cfg.scope === 'created-by-me') {
      query += ` AND [System.CreatedBy] = @Me`;
    }

    return this._http
      .post<AzureDevOpsWiqlResponse>(
        `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/wiql?api-version=6.0`,
        { query },
        { headers: this._getHeaders(cfg).set('Content-Type', 'application/json') },
      )
      .pipe(switchMap((res) => this._mapIssues(res, cfg)));
  }

  private _mapIssues(
    res: AzureDevOpsWiqlResponse,
    cfg: AzureDevOpsCfg,
  ): Observable<AzureDevOpsIssueReduced[]> {
    if (!res.workItems || res.workItems.length === 0) {
      return of([]);
    }
    const ids = res.workItems.map((item) => item.id).slice(0, 50);
    const idsStr = ids.join(',');
    const fields = [
      'System.Id',
      'System.Title',
      'System.WorkItemType',
      'System.State',
      'Microsoft.VSTS.Common.Priority',
      'System.CreatedDate',
      'System.ChangedDate',
      'System.AssignedTo',
      'Microsoft.VSTS.Scheduling.DueDate',
      'Microsoft.VSTS.Scheduling.TargetDate',
      'Microsoft.VSTS.Scheduling.StartDate',
    ].join(',');
    const url =
      `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/workitems` +
      `?ids=${idsStr}&fields=${fields}&api-version=6.0`;
    return this._http
      .get<AzureDevOpsWorkItemsResponse>(url, { headers: this._getHeaders(cfg) })
      .pipe(
        map((detailsRes) => {
          return detailsRes.value.map(
            (item): AzureDevOpsIssueReduced => ({
              id: item.id.toString(),
              summary: `${item.fields['System.WorkItemType']} ${item.id}: ${item.fields['System.Title']}`,
              description: '',
              status: String(item.fields['System.State'] || ''),
              priority: item.fields['Microsoft.VSTS.Common.Priority'] as
                | number
                | undefined,
              created: String(item.fields['System.CreatedDate'] || ''),
              updated: String(item.fields['System.ChangedDate'] || ''),
              assignee: item.fields['System.AssignedTo']?.displayName,
              url: item._links?.html?.href,
              due:
                (item.fields['Microsoft.VSTS.Scheduling.DueDate'] as
                  | string
                  | undefined) ||
                (item.fields['Microsoft.VSTS.Scheduling.TargetDate'] as
                  | string
                  | undefined) ||
                (item.fields['Microsoft.VSTS.Scheduling.StartDate'] as
                  | string
                  | undefined),
            }),
          );
        }),
      );
  }

  getIssueById$(id: string, cfg: AzureDevOpsCfg): Observable<AzureDevOpsIssueReduced> {
    return this._http
      .get<AzureDevOpsWorkItem>(
        `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/workitems/${id}?api-version=6.0`,
        { headers: this._getHeaders(cfg) },
      )
      .pipe(
        map(
          (res): AzureDevOpsIssueReduced => ({
            id: res.id.toString(),
            summary: `${res.fields['System.WorkItemType']} ${res.id}: ${res.fields['System.Title']}`,
            description: (res.fields['System.Description'] as string) || undefined,
            status: String(res.fields['System.State'] || ''),
            priority: res.fields['Microsoft.VSTS.Common.Priority'] as number | undefined,
            created: String(res.fields['System.CreatedDate'] || ''),
            updated: String(res.fields['System.ChangedDate'] || ''),
            assignee: res.fields['System.AssignedTo']?.displayName,
            url: res._links?.html?.href,
            due:
              (res.fields['Microsoft.VSTS.Scheduling.DueDate'] as string | undefined) ||
              (res.fields['Microsoft.VSTS.Scheduling.TargetDate'] as
                | string
                | undefined) ||
              (res.fields['Microsoft.VSTS.Scheduling.StartDate'] as string | undefined),
          }),
        ),
      );
  }

  private _getHeaders(cfg: AzureDevOpsCfg): HttpHeaders {
    const authToken = btoa(`:${cfg.token}`);
    return new HttpHeaders({
      Authorization: `Basic ${authToken}`,
    });
  }

  private _getBaseUrl(cfg: AzureDevOpsCfg): string {
    const host = cfg.host || `https://dev.azure.com/${cfg.organization}`;
    return host.replace(/\/$/, '');
  }
}
