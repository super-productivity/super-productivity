import { Injectable, inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { WorkContextService } from './features/work-context/work-context.service';
import { Observable, of } from 'rxjs';
import { catchError, concatMap, map, switchMap, take } from 'rxjs/operators';
import { Log } from './core/log';
import { WorkContextType } from './features/work-context/work-context.model';
import { TagService } from './features/tag/tag.service';
import { ProjectService } from './features/project/project.service';
import { Store } from '@ngrx/store';
import { selectIsOverlayShown } from './features/focus-mode/store/focus-mode.selectors';
import { DataInitStateService } from './core/data-init/data-init-state.service';
import { GlobalConfigService } from './features/config/global-config.service';
import { DefaultStartPage } from './features/config/default-start-page.const';
import { TODAY_TAG } from './features/tag/tag.const';
import { INBOX_PROJECT } from './features/project/project.const';

@Injectable({ providedIn: 'root' })
export class ActiveWorkContextGuard {
  private _workContextService = inject(WorkContextService);
  private _router = inject(Router);

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<UrlTree> {
    return this._workContextService.activeWorkContextTypeAndId$.pipe(
      take(1),
      switchMap(({ activeType, activeId }) => {
        const { subPageType, param } = next.params;
        const base = activeType === WorkContextType.TAG ? 'tag' : 'project';
        const url = `/${base}/${activeId}/${subPageType}${param ? '/' + param : ''}`;
        const urlTree = this._router.parseUrl(url);
        urlTree.queryParams = next.queryParams;
        return of(urlTree);
      }),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class ValidTagIdGuard {
  private _tagService = inject(TagService);
  private _dataInitStateService = inject(DataInitStateService);

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean> {
    const { id } = next.params;
    return this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() => this._tagService.getTagById$(id)),
      catchError((err) => {
        Log.warn(`ValidTagIdGuard: failed to look up tag '${id}'`, err);
        return of(false);
      }),
      take(1),
      map((tag) => !!tag),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class FocusOverlayOpenGuard {
  private _store = inject(Store);

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean> {
    return this._store.select(selectIsOverlayShown).pipe(map((isShown) => !isShown));
  }

  canActivateChild(
    childRoute: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean> {
    return this.canActivate(childRoute, state);
  }
}

@Injectable({ providedIn: 'root' })
export class ValidProjectIdGuard {
  private _projectService = inject(ProjectService);
  private _dataInitStateService = inject(DataInitStateService);

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean> {
    const { id } = next.params;
    return this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() => this._projectService.getByIdOnce$(id)),
      catchError((err) => {
        Log.warn(`ValidProjectIdGuard: failed to look up project '${id}'`, err);
        return of(false);
      }),
      map((project) => !!project),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class DefaultStartPageGuard {
  private _globalConfigService = inject(GlobalConfigService);
  private _projectService = inject(ProjectService);
  private _dataInitStateService = inject(DataInitStateService);
  private _router = inject(Router);

  private readonly _todayUrl = (): UrlTree =>
    this._router.parseUrl(`/tag/${TODAY_TAG.id}/tasks`);

  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<UrlTree> {
    return this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() => this._globalConfigService.misc$),
      take(1),
      concatMap((miscCfg) => this._resolve(miscCfg?.defaultStartPage)),
    );
  }

  private _resolve(startPage: number | string | undefined): Observable<UrlTree> {
    if (typeof startPage === 'string' && startPage.length > 0) {
      // Project id. Fall back to Today if the project is missing, archived,
      // or hidden from the menu — same cases where the dropdown omits it.
      return this._projectService.getByIdOnce$(startPage).pipe(
        catchError((err) => {
          Log.warn(
            `DefaultStartPageGuard: failed to look up project '${startPage}'`,
            err,
          );
          return of(undefined);
        }),
        map((project) =>
          project && !project.isArchived && !project.isHiddenFromMenu
            ? this._router.parseUrl(`/project/${startPage}/tasks`)
            : this._todayUrl(),
        ),
      );
    }

    const appFeatures = this._globalConfigService.appFeatures();
    switch (startPage ?? DefaultStartPage.Today) {
      case DefaultStartPage.Inbox:
        // Legacy numeric value preserved for old configs.
        return of(this._router.parseUrl(`/project/${INBOX_PROJECT.id}/tasks`));
      case DefaultStartPage.Planner:
        return of(
          appFeatures.isPlannerEnabled
            ? this._router.parseUrl('/planner')
            : this._todayUrl(),
        );
      case DefaultStartPage.Schedule:
        return of(
          appFeatures.isSchedulerEnabled
            ? this._router.parseUrl('/schedule')
            : this._todayUrl(),
        );
      case DefaultStartPage.Boards:
        return of(
          appFeatures.isBoardsEnabled
            ? this._router.parseUrl('/boards')
            : this._todayUrl(),
        );
      case DefaultStartPage.Today:
      default:
        return of(this._todayUrl());
    }
  }
}
