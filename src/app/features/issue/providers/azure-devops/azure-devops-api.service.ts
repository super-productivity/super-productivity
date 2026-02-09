import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AzureDevOpsCfg } from './azure-devops.model';
import { AzureDevOpsIssueReduced } from './azure-devops-issue/azure-devops-issue.model';

@Injectable({
  providedIn: 'root',
})
export class AzureDevOpsApiService {
  private _http = inject(HttpClient);

  getCurrentUser$(cfg: AzureDevOpsCfg): Observable<any> {
    return this._http
      .get(`${this._getBaseUrl(cfg)}/_apis/connectionData?api-version=6.0`, {
        headers: this._getHeaders(cfg),
      })
      .pipe(map((res: any) => res.authenticatedUser));
  }

  searchIssues$(
    searchTerm: string,
    cfg: AzureDevOpsCfg,
  ): Observable<AzureDevOpsIssueReduced[]> {
    const sanitizedSearchTerm = searchTerm.replace(/'/g, "''");
    // prettier-ignore
    let query = `Select [System.Id] From WorkItems Where [System.Title] Contains '${sanitizedSearchTerm}' ` +
      `AND [System.TeamProject] = '${cfg.project}'`;
    if (sanitizedSearchTerm.match(/^\d+$/)) {
      // prettier-ignore
      query = `Select [System.Id] From WorkItems Where ([System.Title] Contains '${sanitizedSearchTerm}' ` +
        `OR [System.Id] = ${sanitizedSearchTerm}) AND [System.TeamProject] = '${cfg.project}'`;
    }

    return this._http
      .post(
        `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/wiql?api-version=6.0`,
        { query },
        { headers: this._getHeaders(cfg).set('Content-Type', 'application/json') },
      )
      .pipe(
        switchMap((res: any) => this._mapIssues(res, cfg)),
        catchError((error) => {
          return throwError(error);
        }),
      );
  }

  getNewIssuesToAddToBacklog$(
    cfg: AzureDevOpsCfg,
  ): Observable<AzureDevOpsIssueReduced[]> {
    // prettier-ignore
    let query = `Select [System.Id] From WorkItems Where [System.TeamProject] = '${cfg.project}' ` +
      `AND [System.State] <> 'Closed' AND [System.State] <> 'Done' AND [System.State] <> 'Removed'`;
    if (cfg.scope === 'assigned-to-me') {
      query += ` AND [System.AssignedTo] = @Me`;
    } else if (cfg.scope === 'created-by-me') {
      query += ` AND [System.CreatedBy] = @Me`;
    }

    return this._http
      .post(
        `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/wiql?api-version=6.0`,
        { query },
        { headers: this._getHeaders(cfg).set('Content-Type', 'application/json') },
      )
      .pipe(switchMap((res: any) => this._mapIssues(res, cfg)));
  }

  private _mapIssues(
    res: any,
    cfg: AzureDevOpsCfg,
  ): Observable<AzureDevOpsIssueReduced[]> {
    if (!res.workItems || res.workItems.length === 0) {
      return of([]);
    }
    const ids = res.workItems.map((item: any) => item.id).slice(0, 50);
    const idsStr = ids.join(',');
    const fields = [
      'System.Id',
      'System.Title',
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
    return this._http.get(url, { headers: this._getHeaders(cfg) }).pipe(
      map((detailsRes: any) => {
        return detailsRes.value.map((item: any) => ({
          id: item.id.toString(),
          summary: item.fields['System.Title'],
          description: '', // We don't fetch description for list to save bandwidth/complexity
          status: item.fields['System.State'],
          priority: item.fields['Microsoft.VSTS.Common.Priority'],
          created: item.fields['System.CreatedDate'],
          updated: item.fields['System.ChangedDate'],
          assignee: item.fields['System.AssignedTo']?.displayName,
          url: item._links?.html?.href,
          due:
            item.fields['Microsoft.VSTS.Scheduling.DueDate'] ||
            item.fields['Microsoft.VSTS.Scheduling.TargetDate'] ||
            item.fields['Microsoft.VSTS.Scheduling.StartDate'],
        }));
      }),
    );
  }

  getIssueById$(id: string, cfg: AzureDevOpsCfg): Observable<AzureDevOpsIssueReduced> {
    return this._http
      .get(
        `${this._getBaseUrl(cfg)}/${cfg.project}/_apis/wit/workitems/${id}?api-version=6.0`,
        { headers: this._getHeaders(cfg) },
      )
      .pipe(
        map((res: any) => {
          return {
            id: res.id.toString(),
            summary: res.fields['System.Title'],
            description: res.fields['System.Description'],
            status: res.fields['System.State'],
            priority: res.fields['Microsoft.VSTS.Common.Priority'],
            created: res.fields['System.CreatedDate'],
            updated: res.fields['System.ChangedDate'],
            assignee: res.fields['System.AssignedTo']?.displayName,
            url: res._links?.html?.href,
            due:
              res.fields['Microsoft.VSTS.Scheduling.DueDate'] ||
              res.fields['Microsoft.VSTS.Scheduling.TargetDate'] ||
              res.fields['Microsoft.VSTS.Scheduling.StartDate'],
          };
        }),
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
