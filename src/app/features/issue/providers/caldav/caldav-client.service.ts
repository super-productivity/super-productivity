import { Injectable, inject } from '@angular/core';
import { CaldavCfg } from './caldav.model';
// @ts-ignore
import type DavClient from '@nextcloud/cdav-library';
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
import { Capacitor } from '@capacitor/core';
import { WebDavHttp } from '../../../../op-log/sync-providers/file-based/webdav/capacitor-webdav-http';
import { toBasicAuthHeader } from '../../../../util/to-basic-auth-header';

// Loaded on first use to keep the library out of the initial bundle.
// @ts-ignore
const loadCdavLibrary = (): Promise<any> => import('@nextcloud/cdav-library');
// Transitive dep of @nextcloud/cdav-library@2.x (xhrProvider was removed).
// @ts-ignore
const loadNextcloudAxios = (): Promise<any> => import('@nextcloud/axios');

/** Minimal calendar surface used by this service (cdav-library no longer deep-exports models). */
interface CalendarLike {
  url: string;
  displayname?: string;
  readOnly?: boolean;
  calendarQuery: (query: unknown[]) => Promise<CalDavTaskData[]>;
  createObject: (
    name: string,
    headers: Record<string, string>,
    data: string,
  ) => Promise<unknown>;
}

interface ClientCache {
  client: DavClient;
  calendars: Map<string, CalendarLike>;
}

interface CalendarHomeLike {
  displayname?: string;
  url: string;
  findAllCalendars: () => Promise<CalendarLike[]>;
}

/** Loose axios shapes we touch; avoid depending on axios types at the app root. */
interface AxiosHeaderBag {
  dav?: string;
  get?: (name: string) => string | undefined;
  set?: (name: string, value: string) => void;
  [name: string]: unknown;
}

interface AxiosRequestConfigLike {
  url?: string;
  method?: string;
  headers?: AxiosHeaderBag | Record<string, unknown>;
  data?: unknown;
  signal?: AbortSignal;
}

interface AxiosResponseLike {
  data: unknown;
  status: number;
  statusText: string;
  headers: AxiosHeaderBag;
  config: AxiosRequestConfigLike;
  request: unknown;
}

interface AxiosInstanceLike {
  defaults: { adapter?: unknown };
  request: (config: AxiosRequestConfigLike) => Promise<AxiosResponseLike>;
}

interface DavRequestLike {
  request: (
    method: string,
    url: string,
    headers?: Record<string, unknown>,
    body?: string | null,
    abortSignal?: AbortSignal | null,
  ) => Promise<{ body: unknown; status: number; headers: AxiosHeaderBag }>;
}

/** Enough of a DAV feature list for connect() when a proxy omits the DAV header. */
const FALLBACK_DAV_HEADER = '1, calendar-access';

interface CalDavTaskData {
  data: string;
  url: string;
  etag: string;
  update?: () => Promise<unknown>;
  delete?: (headers?: Record<string, string>) => Promise<unknown>;
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

  private static _normalizeCalDavPath(value: string): string {
    return value.replace(/\/+$/, '');
  }

  private static _getCalendarUriFromUrl(url: string): string {
    const normalizedUrl = CaldavClientService._normalizeCalDavPath(url);
    return normalizedUrl.substring(normalizedUrl.lastIndexOf('/') + 1);
  }

  private static _isSameCalDavPath(a: string, b: string): boolean {
    return (
      CaldavClientService._normalizeCalDavPath(a) ===
      CaldavClientService._normalizeCalDavPath(b)
    );
  }

  private static _matchesCalendarDisplayName(
    item: { displayname?: string },
    resource: string,
  ): boolean {
    return item.displayname === resource;
  }

  private static _matchesCalendarUri(item: { url: string }, resource: string): boolean {
    return CaldavClientService._getCalendarUriFromUrl(item.url) === resource;
  }

  private static _findMatchingCalendar(
    calendars: CalendarLike[],
    resource: string,
    calendarHome: CalendarHomeLike,
  ): CalendarLike | undefined {
    const concreteCalendars = calendars.filter(
      (item) => !CaldavClientService._isSameCalDavPath(item.url, calendarHome.url),
    );
    const displayNameMatch = concreteCalendars.find((item) =>
      CaldavClientService._matchesCalendarDisplayName(item, resource),
    );

    return (
      displayNameMatch ??
      concreteCalendars.find((item) =>
        CaldavClientService._matchesCalendarUri(item, resource),
      )
    );
  }

  private static async _getAllTodos(
    calendar: CalendarLike,
    filterOpen: boolean,
  ): Promise<CalDavTaskData[]> {
    const { namespaces: NS } = await loadCdavLibrary();
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

  /**
   * The VTODOs with exactly this UID: none when it does not exist. The server's
   * answer is only a pre-filter — text-match is a substring match (RFC 4791
   * §9.7.5), and some servers ignore it and return every VTODO of the calendar
   * (Vikunja, #11182), so taking the first result reads or writes another task.
   */
  private static async _findTaskByUid(
    calendar: CalendarLike,
    taskUid: string,
  ): Promise<CalDavTaskData[]> {
    const { namespaces: NS } = await loadCdavLibrary();
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
    const candidates: CalDavTaskData[] = await calendar.calendarQuery([query]);
    const ICAL = await loadIcalModule();
    return candidates.filter(
      (t) =>
        new ICAL.Component(ICAL.parse(t.data))
          .getFirstSubcomponent('vtodo')
          ?.getFirstPropertyValue('uid') === taskUid,
    );
  }

  // RFC 5545 lists COMPLETED, STATUS, and PERCENT-COMPLETE as independent
  // optional VTODO properties — a server may send any one of them alone to
  // mark a todo done, so the COMPLETED timestamp alone misses STATUS-only
  // todos. The poll mapping and the push dirty-check must agree on this,
  // else reopening a STATUS-only completed todo never reaches the server.
  private static _isTodoCompleted(todo: any): boolean {
    return (
      !!todo.getFirstPropertyValue('completed') ||
      todo.getFirstPropertyValue('status') === CaldavIssueStatus.COMPLETED ||
      +(todo.getFirstPropertyValue('percent-complete') as string) === 100
    );
  }

  private static async _mapTask(task: CalDavTaskData): Promise<CaldavIssue> {
    const ICAL = await loadIcalModule();
    const jCal = ICAL.parse(task.data);
    const comp = new ICAL.Component(jCal);
    const todo = comp.getFirstSubcomponent('vtodo');

    if (!todo) {
      IssueLog.log('No todo found for CalDAV task');
      throw new Error('No todo found for task');
    }

    const categoriesProperty = todo.getAllProperties('categories')[0];
    const categories: string[] = categoriesProperty?.getValues() || [];

    const dtstart = todo.getFirstPropertyValue('dtstart') as any;
    const due = todo.getFirstPropertyValue('due') as any;
    const status =
      (todo.getFirstPropertyValue('status') as CaldavIssueStatus) || undefined;
    const percentComplete =
      +(todo.getFirstPropertyValue('percent-complete') as string) || undefined;

    return {
      id: todo.getFirstPropertyValue('uid') as string,
      completed: CaldavClientService._isTodoCompleted(todo),
      item_url: task.url,
      summary: (todo.getFirstPropertyValue('summary') as string) || '',
      start: dtstart?.toJSDate().getTime(),
      isAllDay: dtstart ? dtstart.isDate === true : undefined,
      due: due?.toJSDate().getTime(),
      isDueAllDay: due ? due.isDate === true : undefined,
      note: (todo.getFirstPropertyValue('description') as string) || undefined,
      status,
      priority: +(todo.getFirstPropertyValue('priority') as string) || undefined,
      percent_complete: percentComplete,
      location: todo.getFirstPropertyValue('location') as string,
      labels: categories,
      etag_hash: this._hashEtag(task.etag),
      related_to: CaldavClientService._getParentRelatedTo(todo),
    };
  }

  /**
   * Returns the UID referenced by the first RELATED-TO property whose RELTYPE
   * parameter is absent or explicitly set to PARENT (RFC 5545 §3.8.4.5).
   * CHILD and SIBLING relations are ignored so we never invert the hierarchy.
   */
  private static _getParentRelatedTo(todo: any): string | undefined {
    const props = todo.getAllProperties('related-to') as any[];
    for (const prop of props) {
      const reltype = (prop.getParameter('reltype') as string | null) ?? 'PARENT';
      if (reltype.toUpperCase() === 'PARENT') {
        return (prop.getFirstValue() as string) || undefined;
      }
    }
    return undefined;
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
      await this._prepareHttpTransport();
      const { default: DavClient } = await loadCdavLibrary();
      // v2 removed xhrProvider; auth goes through defaultHeaders, native HTTP
      // through a custom @nextcloud/axios adapter installed above.
      const client = new DavClient({
        rootUrl: cfg.caldavUrl,
        defaultHeaders: {
          Authorization: toBasicAuthHeader(cfg.username, cfg.password),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'X-Requested-With': 'SuperProductivity',
        },
      });
      this._ensureDavHeaderFallback(client);

      await client
        .connect({ enableCalDAV: true })
        .catch((err: unknown) => this._handleNetErr(err));

      const cache = {
        client,
        calendars: new Map(),
      };
      this._clientCache.set(client_key, cache);

      return cache;
    }
  }

  async _getCalendar(cfg: CaldavCfg): Promise<CalendarLike> {
    const clientCache = await this._get_client(cfg);
    const resource = cfg.resourceName as string;

    if (clientCache.calendars.has(resource)) {
      return clientCache.calendars.get(resource)!;
    }

    let lastCalendarHomeError: unknown;

    for (const calendarHome of clientCache.client
      .calendarHomes as unknown as CalendarHomeLike[]) {
      const calendars = await calendarHome.findAllCalendars().catch((err: unknown) => {
        lastCalendarHomeError = err;
        return null;
      });

      if (!calendars) {
        continue;
      }

      const calendar = CaldavClientService._findMatchingCalendar(
        calendars,
        resource,
        calendarHome,
      );

      if (calendar !== undefined) {
        clientCache.calendars.set(resource, calendar);
        return calendar;
      }
    }

    if (lastCalendarHomeError) {
      this._handleNetErr(lastCalendarHomeError);
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

  getById$(id: string | number, caldavCfg: CaldavCfg): Observable<CaldavIssue | null> {
    if (typeof id === 'number') {
      id = id.toString(10);
    }
    return from(this._getTask(caldavCfg, id)).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  getByIds$(ids: string[], cfg: CaldavCfg): Observable<CaldavIssue[]> {
    const idSet = new Set(ids);
    return from(
      this._getTasks(cfg, false, false).then((tasks) =>
        tasks.filter((task) => idSet.has(task.id)),
      ),
    ).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  updateFields$(
    caldavCfg: CaldavCfg,
    issueId: string,
    fields: { completed?: boolean; summary?: string; note?: string },
  ): Observable<void> {
    return from(this._updateTask(caldavCfg, issueId, fields)).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  createTask$(
    caldavCfg: CaldavCfg,
    task: { uid: string; summary: string },
  ): Observable<CaldavIssue> {
    return from(this._createTask(caldavCfg, task)).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  deleteTask$(caldavCfg: CaldavCfg, issueId: string): Observable<void> {
    return from(this._deleteTask(caldavCfg, issueId)).pipe(
      catchError((err) => throwError({ [HANDLED_ERROR_PROP_STR]: 'Caldav: ' + err })),
    );
  }

  protected get isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  protected _webDavRequest(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    data?: string;
  }): Promise<{ status: number; headers: Record<string, string>; data: string }> {
    return WebDavHttp.request(options);
  }

  /**
   * cdav-library@2 uses @nextcloud/axios (no xhrProvider). On native WebViews,
   * browser HTTP is CORS-blocked, so point that shared axios instance at
   * Capacitor WebDavHttp instead.
   */
  private async _prepareHttpTransport(): Promise<void> {
    if (!this.isNativePlatform) {
      return;
    }
    const axiosMod = await loadNextcloudAxios();
    const axios = axiosMod.default as AxiosInstanceLike;
    axios.defaults.adapter = this._createNativeAxiosAdapter();
  }

  /**
   * v2.x throws if the OPTIONS DAV header is missing/empty. Proxies and some
   * native HTTP stacks omit it; synthesize a minimal feature list so connect()
   * can proceed (advertisedFeatures is not used for control flow).
   */
  private _ensureDavHeaderFallback(client: DavClient): void {
    const request = (client as unknown as { _request: DavRequestLike })._request;
    const originalRequest = request.request.bind(request);
    request.request = async (
      method: string,
      url: string,
      headers: Record<string, unknown> = {},
      body: string | null = null,
      abortSignal: AbortSignal | null = null,
    ) => {
      const response = await originalRequest(method, url, headers, body, abortSignal);
      CaldavClientService._applyDavHeaderFallback(response.headers);
      return response;
    };
  }

  private static _applyDavHeaderFallback(headers: AxiosHeaderBag): void {
    const existing =
      (typeof headers.get === 'function' ? headers.get('dav') : undefined) ??
      (typeof headers.dav === 'string' ? headers.dav : undefined);
    if (typeof existing === 'string' && existing.trim() !== '') {
      return;
    }
    if (typeof headers.set === 'function') {
      headers.set('dav', FALLBACK_DAV_HEADER);
      return;
    }
    headers.dav = FALLBACK_DAV_HEADER;
  }

  private static _stringifyHeaders(
    headers: AxiosHeaderBag | Record<string, unknown> | undefined,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers) {
      return out;
    }
    for (const [name, value] of Object.entries(headers)) {
      if (value == null || typeof value === 'function') {
        continue;
      }
      // Coerce like a real XHR: cdav-library still passes numeric Depth, and the
      // iOS plugin drops all headers if any value is not a string (#11232).
      out[name] = String(value);
    }
    return out;
  }

  private _createNativeAxiosAdapter(): (
    config: AxiosRequestConfigLike,
  ) => Promise<AxiosResponseLike> {
    return async (config: AxiosRequestConfigLike): Promise<AxiosResponseLike> => {
      if (config.signal?.aborted) {
        const abortErr = new Error('Request aborted');
        abortErr.name = 'CanceledError';
        throw abortErr;
      }
      const url = config.url;
      if (!url) {
        throw new Error('CalDAV native adapter: missing request URL');
      }
      const headers = CaldavClientService._stringifyHeaders(config.headers);
      const data =
        config.data == null
          ? undefined
          : typeof config.data === 'string'
            ? config.data
            : String(config.data);

      const res = await this._webDavRequest({
        url,
        method: (config.method || 'GET').toUpperCase(),
        headers,
        data,
      });

      const responseHeaders: AxiosHeaderBag = {};
      for (const [k, v] of Object.entries(res.headers || {})) {
        responseHeaders[k.toLowerCase()] = v;
      }
      CaldavClientService._applyDavHeaderFallback(responseHeaders);

      return {
        data: res.data || '',
        status: res.status,
        statusText: '',
        headers: responseHeaders,
        config,
        request: {},
      };
    };
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

  /**
   * The VTODO, or null when the calendar has none with this UID (deleted on the
   * server): an ordinary state the callers decide on, not an error to raise
   * from every read of a linked task (#11583).
   */
  private async _getTask(cfg: CaldavCfg, uid: string): Promise<CaldavIssue | null> {
    const cal = await this._getCalendar(cfg);
    const tasks = await CaldavClientService._findTaskByUid(cal, uid).catch((err) =>
      this._handleNetErr(err),
    );
    return tasks.length ? await CaldavClientService._mapTask(tasks[0]) : null;
  }

  private async _createTask(
    cfg: CaldavCfg,
    { uid, summary }: { uid: string; summary: string },
  ): Promise<CaldavIssue> {
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

    const ICAL = await loadIcalModule();
    // UTC: RFC 5545 requires it for DTSTAMP, CREATED and LAST-MODIFIED.
    const now = ICAL.Time.fromJSDate(new Date(), true);
    const vcalendar = new ICAL.Component(['vcalendar', [], []]);
    vcalendar.updatePropertyWithValue('version', '2.0');
    vcalendar.updatePropertyWithValue('prodid', '-//Super Productivity//EN');
    const todo = new ICAL.Component('vtodo');
    todo.updatePropertyWithValue('uid', uid);
    todo.updatePropertyWithValue('dtstamp', now);
    todo.updatePropertyWithValue('created', now);
    todo.updatePropertyWithValue('last-modified', now);
    todo.updatePropertyWithValue('summary', summary);
    todo.updatePropertyWithValue('status', CaldavIssueStatus.NEEDS_ACTION);
    todo.updatePropertyWithValue('sequence', 0);
    // Import keeps only VTODOs carrying the category filter, so without it the
    // new VTODO would be filtered out of every later import and look lost.
    if (cfg.categoryFilter) {
      todo.updatePropertyWithValue('categories', cfg.categoryFilter);
    }
    vcalendar.addSubcomponent(todo);

    let createErr: unknown;
    try {
      // The resource name derives from the UID, and If-None-Match: * never
      // overwrites: a repeated create finds the first VTODO (412) instead of
      // writing a second one.
      await cal.createObject(
        encodeURIComponent(uid) + '.ics',
        {
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'Content-Type': 'text/calendar; charset=utf-8',
          // eslint-disable-next-line @typescript-eslint/naming-convention
          'If-None-Match': '*',
        },
        vcalendar.toString(),
      );
    } catch (err) {
      // createObject PUTs and then PROPFINDs the new resource, so an error
      // doesn't prove the VTODO is missing — whether the UID now exists decides.
      createErr = err;
    }
    const created = await CaldavClientService._findTaskByUid(cal, uid).catch((err) =>
      this._handleNetErr(err),
    );
    if (created.length < 1) {
      this._handleNetErr(createErr ?? 'created VTODO not found: ' + uid);
    }
    return CaldavClientService._mapTask(created[0]);
  }

  private async _deleteTask(cfg: CaldavCfg, uid: string): Promise<void> {
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
    const task = tasks[0];
    // Already gone on the server (deleted there, or by another device) — the
    // goal state is reached, so stay silent.
    if (!task) {
      return;
    }
    if (task.delete) {
      // If-Match on the ETag just fetched: a write that lands between this
      // lookup and the DELETE fails it instead of being deleted unseen.
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const headers: Record<string, string> = task.etag ? { 'If-Match': task.etag } : {};
      await task.delete(headers).catch((err: { status?: number } | undefined) => {
        // Deleted elsewhere between the lookup and the DELETE: same as above.
        if (err?.status === 404 || err?.status === 410) {
          return;
        }
        this._handleNetErr(err);
      });
    }
  }

  private async _updateTask(
    cfg: CaldavCfg,
    uid: string,
    updates: { completed?: boolean; summary?: string; note?: string },
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
      IssueLog.err('No todo found for CalDAV task');
      return;
    }

    const now = ICAL.Time.now();
    let changeObserved = false;

    const oldCompleted = CaldavClientService._isTodoCompleted(todo);
    if (updates.completed !== undefined && updates.completed !== oldCompleted) {
      if (updates.completed) {
        todo.updatePropertyWithValue('completed', now);
        todo.updatePropertyWithValue('percent-complete', '100');
        todo.updatePropertyWithValue('status', CaldavIssueStatus.COMPLETED);
      } else {
        todo.removeProperty('completed');
        todo.removeProperty('percent-complete');
        todo.updatePropertyWithValue('status', CaldavIssueStatus.NEEDS_ACTION);
      }
      changeObserved = true;
    }

    if (updates.summary !== undefined) {
      const oldSummary = todo.getFirstPropertyValue('summary');
      if (updates.summary !== oldSummary) {
        todo.updatePropertyWithValue('summary', updates.summary);
        changeObserved = true;
      }
    }

    if (updates.note !== undefined) {
      const oldNote = (todo.getFirstPropertyValue('description') as string) || '';
      if (updates.note !== oldNote) {
        todo.updatePropertyWithValue('description', updates.note);
        changeObserved = true;
      }
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
