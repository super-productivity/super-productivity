import { Injectable, inject } from '@angular/core';
import { CaldavCfg } from './caldav.model';
// @ts-ignore
import DavClient, { namespaces as NS } from '@nextcloud/cdav-library';
// @ts-ignore
import Calendar from 'cdav-library/models/calendar';
import { loadIcalModule } from '../../../schedule/ical/ical-lazy-loader';

import { from, Observable, throwError } from 'rxjs';
import { CaldavIssue, CaldavIssueStatus } from './caldav-issue.model';
import { CALDAV_TYPE, ISSUE_PROVIDER_HUMANIZED } from '../../issue.const';
import { SearchResultItem } from '../../issue.model';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { catchError } from 'rxjs/operators';
import { HANDLED_ERROR_PROP_STR } from '../../../../app.constants';
import { throwHandledError } from '../../../../util/throw-handled-error';
import { IssueLog } from '../../../../core/log';

interface ClientCache {
  client: DavClient;
  calendars: Map<string, Calendar>;
}

interface CalDavTaskData {
  data: string;
  url: string;
  etag: string;
  update?: () => Promise<void>;
}

@Injectable({
  providedIn: 'root',
})
export class CaldavClientService {
  private readonly _snackService = inject(SnackService);

  private _clientCache = new Map<string, ClientCache>();

  private static _isValidSettings(cfg: CaldavCfg): boolean {
    return (
      !!cfg &&
      !!cfg.caldavUrl &&
      cfg.caldavUrl.length > 0 &&
      !!cfg.resourceName &&
      cfg.resourceName.length > 0 &&
      !!cfg.username &&
      cfg.username.length > 0 &&
      !!cfg.password &&
      cfg.password.length > 0
    );
  }

  private static _getCalendarUriFromUrl(url: string): string {
    if (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }

    return url.substring(url.lastIndexOf('/') + 1);
  }

  private static async _getAllTodos(
    calendar: Calendar,
    filterOpen: boolean,
  ): Promise<CalDavTaskData[]> {
    const query = {
      name: [NS.IETF_CALDAV, 'comp-filter'],
      attributes: [['name', 'VCALENDAR']],
      children: [
        {
          name: [NS.IETF_CALDAV, 'comp-filter'],
          attributes: [['name', 'VTODO']],
        },
      ],
    };

    if (filterOpen) {
      // @ts-ignore
      query.children[0].children = [
        {
          name: [NS.IETF_CALDAV, 'prop-filter'],
          attributes: [['name', 'completed']],
          children: [
            {
              name: [NS.IETF_CALDAV, 'is-not-defined'],
            },
          ],
        },
      ];
    }

    return await calendar.calendarQuery([query]);
  }

  private static async _findTaskByUid(
    calendar: Calendar,
    taskUid: string,
  ): Promise<CalDavTaskData[]> {
    const query = {
      name: [NS.IETF_CALDAV, 'comp-filter'],
      attributes: [['name', 'VCALENDAR']],
      children: [
        {
          name: [NS.IETF_CALDAV, 'comp-filter'],
          attributes: [['name', 'VTODO']],
          children: [
            {
              name: [NS.IETF_CALDAV, 'prop-filter'],
              attributes: [['name', 'uid']],
              children: [
                {
                  name: [NS.IETF_CALDAV, 'text-match'],
                  value: taskUid,
                },
              ],
            },
          ],
        },
      ],
    };
    return await calendar.calendarQuery([query]);
  }

  private static async _mapTask(task: CalDavTaskData): Promise<CaldavIssue> {
    const ICAL = await loadIcalModule();
    const jCal = ICAL.parse(task.data);
    const comp = new ICAL.Component(jCal);
    const todo = comp.getFirstSubcomponent('vtodo');

    if (!todo) {
      IssueLog.log(task);
      throw new Error('No todo found for task');
    }

    const categoriesProperty = todo.getAllProperties('categories')[0];
    const categories: string[] = categoriesProperty?.getValues() || [];

    return {
      id: todo.getFirstPropertyValue('uid') as string,
      completed: !!todo.getFirstPropertyValue('completed'),
      item_url: task.url,
      summary: (todo.getFirstPropertyValue('summary') as string) || '',
      start: (todo.getFirstPropertyValue('dtstart') as any)?.toJSDate().getTime(),
      due: (todo.getFirstPropertyValue('due') as any)?.toJSDate().getTime(),
      note: (todo.getFirstPropertyValue('description') as string) || undefined,
      status: (todo.getFirstPropertyValue('status') as CaldavIssueStatus) || undefined,
      priority: +(todo.getFirstPropertyValue('priority') as string) || undefined,
      percent_complete:
        +(todo.getFirstPropertyValue('percent-complete') as string) || undefined,
      location: todo.getFirstPropertyValue('location') as string,
      labels: categories,
      etag_hash: this._hashEtag(task.etag),
      related_to: (todo.getFirstPropertyValue('related-to') as string) || undefined,
    };
  }

  private static _hashEtag(etag: string): number {
    let hash = 0;
    let i;
    let chr;
    if (etag.length === 0) {
      return hash;
    }
    for (i = 0; i < etag.length; i++) {
      chr = etag.charCodeAt(i);
      hash = (hash << 5) - hash + chr;
      // Convert to 32bit integer
      hash |= 0;
    }
    return hash;
  }

  async _get_client(cfg: CaldavCfg): Promise<ClientCache> {
    this._checkSettings(cfg);

    const client_key = `${cfg.caldavUrl}|${cfg.username}|${cfg.password}`;

    if (this._clientCache.has(client_key)) {
      return this._clientCache.get(client_key) as ClientCache;
    } else {
      const client = new DavClient(
        {
          rootUrl: cfg.caldavUrl,
        },
        this._getXhrProvider(cfg),
      );

      await client
        .connect({ enableCalDAV: true })
        .catch((err) => this._handleNetErr(err));

      const cache = {
        client,
        calendars: new Map(),
      };
      this._clientCache.set(client_key, cache);

      return cache;
    }
  }

  async _getCalendar(cfg: CaldavCfg): Promise<Calendar> {
    const clientCache = await this._get_client(cfg);
    const resource = cfg.resourceName as string;

    if (clientCache.calendars.has(resource)) {
      return clientCache.calendars.get(resource);
    }

    const calendars = await clientCache.client.calendarHomes[0]
      .findAllCalendars()
      .catch((err) => this._handleNetErr(err));

    const calendar = calendars.find(
      (item: Calendar) =>
        (item.displayname || CaldavClientService._getCalendarUriFromUrl(item.url)) ===
        resource,
    );

    if (calendar !== undefined) {
      clientCache.calendars.set(resource, calendar);
      return calendar;
    }

    this._snackService.open({
      type: 'ERROR',
      translateParams: {
        calendarName: cfg.resourceName as string,
      },
      msg: T.F.CALDAV.S.CALENDAR_NOT_FOUND,
    });
    throw new Error('CALENDAR NOT FOUND: ' + cfg.resourceName);
  }

  getOpenTasks$(cfg: CaldavCfg): Observable<CaldavIssue[]> {
    return from(this._getTasks(cfg, true, true)).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  searchOpenTasks$(text: string, cfg: CaldavCfg): Observable<SearchResultItem[]> {
    return from(
      this._getTasks(cfg, true, true).then((tasks) =>
        tasks
          .filter((todo) => todo.summary.includes(text))
          .map((todo) => {
            return {
              title: todo.summary,
              issueType: CALDAV_TYPE,
              issueData: todo,
            };
          }),
      ),
    ).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  getById$(id: string | number, caldavCfg: CaldavCfg): Observable<CaldavIssue> {
    if (typeof id === 'number') {
      id = id.toString(10);
    }
    return from(this._getTask(caldavCfg, id)).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  getByIds$(ids: string[], cfg: CaldavCfg): Observable<CaldavIssue[]> {
    return from(
      this._getTasks(cfg, false, false).then((tasks) =>
        tasks.filter((task) => task.id in ids),
      ),
    ).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  updateState$(
    caldavCfg: CaldavCfg,
    issueId: string,
    completed: boolean,
    summary: string,
  ): Observable<void> {
    return from(
      this._updateTask(caldavCfg, issueId, { completed: completed, summary: summary }),
    ).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  private _getXhrProvider(cfg: CaldavCfg): () => XMLHttpRequest {
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    function xhrProvider(): XMLHttpRequest {
      const xhr = new XMLHttpRequest();
      const oldOpen = xhr.open;

      // override open() method to add headers

      xhr.open = function (): void {
        // @ts-ignore
        // eslint-disable-next-line prefer-rest-params
        const result = oldOpen.apply(this, arguments);
        // @ts-ignore
        xhr.setRequestHeader('X-Requested-With', 'SuperProductivity');
        xhr.setRequestHeader(
          'Authorization',
          'Basic ' + btoa(cfg.username + ':' + cfg.password),
        );
        return result;
      };
      return xhr;
    }

    return xhrProvider;
  }

  private _handleNetErr(err: unknown): never {
    this._snackService.open({
      type: 'ERROR',
      msg: T.F.ISSUE.S.ERR_NETWORK,
      translateParams: {
        issueProviderName: ISSUE_PROVIDER_HUMANIZED[CALDAV_TYPE],
      },
    });
    throw new Error('CALDAV NETWORK ERROR: ' + err);
  }

  private _checkSettings(cfg: CaldavCfg): void {
    if (!CaldavClientService._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: ISSUE_PROVIDER_HUMANIZED[CALDAV_TYPE],
        },
      });
      throwHandledError('CalDav: Not enough settings');
    }
  }

  private async _getTasks(
    cfg: CaldavCfg,
    filterOpen: boolean,
    filterCategory: boolean,
  ): Promise<CaldavIssue[]> {
    const cal = await this._getCalendar(cfg);
    const tasks = await CaldavClientService._getAllTodos(cal, filterOpen).catch((err) =>
      this._handleNetErr(err),
    );
    const mappedTasks = await Promise.all(
      tasks.map((t) => CaldavClientService._mapTask(t)),
    );
    return mappedTasks.filter(
      (t: CaldavIssue) =>
        !filterCategory || !cfg.categoryFilter || t.labels.includes(cfg.categoryFilter),
    );
  }

  private async _getTask(cfg: CaldavCfg, uid: string): Promise<CaldavIssue> {
    const cal = await this._getCalendar(cfg);
    const task = await CaldavClientService._findTaskByUid(cal, uid).catch((err) =>
      this._handleNetErr(err),
    );

    if (task.length < 1) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.CALDAV.S.ISSUE_NOT_FOUND,
      });
      throw new Error('ISSUE NOT FOUND: ' + uid);
    }

    return await CaldavClientService._mapTask(task[0]);
  }

  private async _updateTask(
    cfg: CaldavCfg,
    uid: string,
    updates: { completed: boolean; summary: string },
  ): Promise<void> {
    const cal = await this._getCalendar(cfg);

    if (cal.readOnly) {
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          calendarName: cfg.resourceName as string,
        },
        msg: T.F.CALDAV.S.CALENDAR_READ_ONLY,
      });
      throw new Error('CALENDAR READ ONLY: ' + cfg.resourceName);
    }

    const tasks = await CaldavClientService._findTaskByUid(cal, uid).catch((err) =>
      this._handleNetErr(err),
    );

    if (tasks.length < 1) {
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          issueId: uid,
        },
        msg: T.F.CALDAV.S.ISSUE_NOT_FOUND,
      });
      throw new Error('ISSUE NOT FOUND: ' + uid);
    }

    const task = tasks[0];
    const ICAL = await loadIcalModule();
    const jCal = ICAL.parse(task.data);
    const comp = new ICAL.Component(jCal);
    const todo = comp.getFirstSubcomponent('vtodo');

    if (!todo) {
      IssueLog.err('No todo found for task', task);
      return;
    }

    const now = ICAL.Time.now();
    let changeObserved = false;

    const oldCompleted = !!todo.getFirstPropertyValue('completed');
    if (updates.completed !== oldCompleted) {
      if (updates.completed) {
        todo.updatePropertyWithValue('completed', now);
      } else {
        todo.removeProperty('completed');
      }
      changeObserved = true;
    }

    const oldSummary = todo.getFirstPropertyValue('summary');
    if (updates.summary !== oldSummary) {
      todo.updatePropertyWithValue('summary', updates.summary);
      changeObserved = true;
    }

    if (!changeObserved) {
      return;
    }
    todo.updatePropertyWithValue('last-modified', now);
    todo.updatePropertyWithValue('dtstamp', now);

    // https://datatracker.ietf.org/doc/html/rfc5545#section-3.8.7.4
    // Some calendar clients do not see updates (completion) submitted by SuperProductivity as the 'sequence' number is unchanged.
    // As 'sequence' starts at 0 and completing probably counts as a major change, then it should be at least 1 in the end,
    // if no other changes have been written.
    const sequence = todo.getFirstPropertyValue('sequence');
    const sequenceInt = sequence ? parseInt(sequence as string, 10) + 1 : 1;
    todo.updatePropertyWithValue('sequence', sequenceInt);

    task.data = ICAL.stringify(jCal);
    if (task.update) {
      await task.update().catch((err) => this._handleNetErr(err));
    }
  }
}
