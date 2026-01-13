import { inject, Injectable } from '@angular/core';
import { combineLatest, Observable, Subject } from 'rxjs';
import { TimeTrackingState, TTDateMap, TTWorkContextData } from './time-tracking.model';
import { first, map, shareReplay, startWith, switchMap } from 'rxjs/operators';
import { mergeTimeTrackingStates } from './merge-time-tracking-states';
import { Store } from '@ngrx/store';
import { selectTimeTrackingState } from './store/time-tracking.selectors';
import { ArchiveDbAdapter } from '../../core/persistence/archive-db-adapter.service';
import { WorkContextType, WorkStartEnd } from '../work-context/work-context.model';
import { ImpossibleError } from '../../op-log/sync-exports';
import { toLegacyWorkStartEndMaps } from './to-legacy-work-start-end-maps';
import { TimeTrackingActions } from './store/time-tracking.actions';
import { Log } from '../../core/log';
import { initialTimeTrackingState } from './store/time-tracking.reducer';

@Injectable({
  providedIn: 'root',
})
export class TimeTrackingService {
  private _store = inject(Store);
  private _archiveDbAdapter = inject(ArchiveDbAdapter);

  private _archiveYoungUpdateTrigger$ = new Subject();
  private _archiveOldUpdateTrigger$ = new Subject();

  current$: Observable<TimeTrackingState> = this._store.select(selectTimeTrackingState);
  archiveYoung$: Observable<TimeTrackingState> = this._archiveYoungUpdateTrigger$.pipe(
    startWith(null),
    switchMap(async () => {
      const archive = await this._archiveDbAdapter.loadArchiveYoung();
      return archive?.timeTracking || initialTimeTrackingState;
    }),
    shareReplay(1),
  );

  archiveOld$: Observable<TimeTrackingState> = this._archiveOldUpdateTrigger$.pipe(
    startWith(null),
    switchMap(async () => {
      const archive = await this._archiveDbAdapter.loadArchiveOld();
      return archive?.timeTracking || initialTimeTrackingState;
    }),
    shareReplay(1),
  );

  state$: Observable<TimeTrackingState> = combineLatest([
    this.current$,
    this.archiveYoung$,
    this.archiveOld$,
  ]).pipe(
    map(([current, archive, oldArchive]) =>
      mergeTimeTrackingStates({ current, archiveYoung: archive, archiveOld: oldArchive }),
    ),
    shareReplay(1),
  );

  getWorkStartEndForWorkContext$(ctx: {
    id: string;
    type: WorkContextType;
  }): Observable<TTDateMap<TTWorkContextData>> {
    const { id, type } = ctx;
    return this.state$.pipe(
      map((state) => {
        if (type === 'PROJECT') {
          return state.project[id] || ({} as TTDateMap<TTWorkContextData>);
        }
        if (type === 'TAG') {
          return state.tag[id] || ({} as TTDateMap<TTWorkContextData>);
        }
        throw new ImpossibleError('Invalid work context type ' + type);
      }),
    );
  }

  async cleanupDataEverywhereForProject(projectId: string): Promise<void> {
    const current = await this.current$.pipe(first()).toPromise();
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    Log.log({ current, archiveYoung, archiveOld });

    if (projectId in current.project) {
      const newProject = { ...current.project };
      delete newProject[projectId];
      this._store.dispatch(
        TimeTrackingActions.updateWholeState({
          newState: {
            ...current,
            project: { ...newProject },
          },
        }),
      );
    }
    if (archiveYoung && projectId in archiveYoung.timeTracking.project) {
      delete archiveYoung.timeTracking.project[projectId];
      await this._archiveDbAdapter.saveArchiveYoung(archiveYoung);
      this._archiveYoungUpdateTrigger$.next(undefined);
    }

    if (archiveOld && projectId in archiveOld.timeTracking.project) {
      delete archiveOld.timeTracking.project[projectId];
      await this._archiveDbAdapter.saveArchiveOld(archiveOld);
      this._archiveOldUpdateTrigger$.next(undefined);
    }
  }

  /**
   * @deprecated Use cleanupArchiveDataForTag instead.
   * Current state cleanup is now handled atomically in tag-shared.reducer.ts.
   */
  async cleanupDataEverywhereForTag(tagId: string): Promise<void> {
    const current = await this.current$.pipe(first()).toPromise();
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    if (tagId in current.tag) {
      const newTag = { ...current.tag };
      delete newTag[tagId];
      this._store.dispatch(
        TimeTrackingActions.updateWholeState({
          newState: {
            ...current,
            tag: { ...newTag },
          },
        }),
      );
    }

    if (archiveYoung && tagId in archiveYoung.timeTracking.tag) {
      delete archiveYoung.timeTracking.tag[tagId];
      await this._archiveDbAdapter.saveArchiveYoung(archiveYoung);
      this._archiveYoungUpdateTrigger$.next(undefined);
    }

    if (archiveOld && tagId in archiveOld.timeTracking.tag) {
      delete archiveOld.timeTracking.tag[tagId];
      await this._archiveDbAdapter.saveArchiveOld(archiveOld);
      this._archiveOldUpdateTrigger$.next(undefined);
    }
  }

  /**
   * Cleans up time tracking data for a deleted tag from archives only.
   * Current state cleanup is handled atomically in tag-shared.reducer.ts.
   */
  async cleanupArchiveDataForTag(tagId: string): Promise<void> {
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    if (archiveYoung && tagId in archiveYoung.timeTracking.tag) {
      delete archiveYoung.timeTracking.tag[tagId];
      await this._archiveDbAdapter.saveArchiveYoung(archiveYoung);
      this._archiveYoungUpdateTrigger$.next(undefined);
    }

    if (archiveOld && tagId in archiveOld.timeTracking.tag) {
      delete archiveOld.timeTracking.tag[tagId];
      await this._archiveDbAdapter.saveArchiveOld(archiveOld);
      this._archiveOldUpdateTrigger$.next(undefined);
    }
  }

  async getWorkStartEndForWorkContext(ctx: {
    id: string;
    type: WorkContextType;
  }): Promise<TTDateMap<TTWorkContextData>> {
    return this.getWorkStartEndForWorkContext$(ctx).pipe(first()).toPromise();
  }

  async getLegacyWorkStartEndForWorkContext(ctx: {
    id: string;
    type: WorkContextType;
  }): Promise<{
    workStart: WorkStartEnd;
    workEnd: WorkStartEnd;
  }> {
    const d = await this.getWorkStartEndForWorkContext(ctx);
    return toLegacyWorkStartEndMaps(d);
  }
}
