import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { DueTaskBadgeEffects } from './due-task-badge.effects';
import { DueTaskBadgeService } from '../../../core/platform/due-task-badge.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { MiscConfig } from '../../config/global-config.model';
import { DEFAULT_TASK, Task } from '../../tasks/task.model';
import {
  SchedulingSnapshot,
  selectTaskSchedulingSnapshot,
} from '../../tasks/store/task.selectors';
import {
  selectTodayStr,
  selectStartOfNextDayDiffMs,
} from '../../../root-store/app-state/app-state.selectors';

describe('DueTaskBadgeEffects', () => {
  let effects: DueTaskBadgeEffects;
  let store: MockStore;
  let misc$: BehaviorSubject<Partial<MiscConfig>>;
  let inSyncWindow$: BehaviorSubject<boolean>;
  let initialSyncGateOpen$: BehaviorSubject<boolean>;
  let setCount: jasmine.Spy;

  const task: Task = {
    ...DEFAULT_TASK,
    id: 'T1',
    title: 'Task',
    projectId: 'project-1',
  };

  const schedulingTask = (changes: Partial<Task> = {}): SchedulingSnapshot =>
    selectTaskSchedulingSnapshot.projector([{ ...task, ...changes }])[0];

  beforeEach(() => {
    misc$ = new BehaviorSubject<Partial<MiscConfig>>({ isShowDueTaskBadge: true });
    inSyncWindow$ = new BehaviorSubject(false);
    initialSyncGateOpen$ = new BehaviorSubject(true);
    setCount = jasmine.createSpy('setCount').and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        DueTaskBadgeEffects,
        provideMockStore({
          selectors: [
            {
              selector: selectTaskSchedulingSnapshot,
              value: [schedulingTask({ dueDay: '2026-10-03' })],
            },
            { selector: selectTodayStr, value: '2026-10-03' },
            { selector: selectStartOfNextDayDiffMs, value: 0 },
          ],
        }),
        { provide: GlobalConfigService, useValue: { misc$ } },
        {
          provide: HydrationStateService,
          useValue: {
            isInSyncWindow$: inSyncWindow$,
            isInSyncWindow: () => inSyncWindow$.value,
          },
        },
        {
          provide: SyncTriggerService,
          useValue: {
            initialSyncGateOpen$,
            isInitialSyncDoneSync: () => initialSyncGateOpen$.value,
          },
        },
        { provide: DueTaskBadgeService, useValue: { setCount } },
      ],
    });

    effects = TestBed.inject(DueTaskBadgeEffects);
    store = TestBed.inject(MockStore);
  });

  afterEach(() => {
    store.resetSelectors();
  });

  it('writes the due count and clears when the setting is turned off', () => {
    const counts: number[] = [];
    const sub = effects.syncDueTaskBadge$.subscribe((count) => counts.push(count));
    expect(counts).toEqual([1]);
    expect(setCount).toHaveBeenCalledWith(1);

    store.overrideSelector(selectTaskSchedulingSnapshot, [
      schedulingTask({ dueDay: '2026-10-03', isDone: true }),
    ]);
    store.refreshState();
    expect(counts).toEqual([1, 0]);
    expect(setCount).toHaveBeenCalledWith(0);

    misc$.next({ isShowDueTaskBadge: false });
    expect(setCount).toHaveBeenCalledWith(0);
    sub.unsubscribe();
  });

  it('does not touch native until the badge was ever non-zero', () => {
    misc$.next({ isShowDueTaskBadge: false });
    const counts: number[] = [];
    const sub = effects.syncDueTaskBadge$.subscribe((count) => counts.push(count));
    store.overrideSelector(selectTaskSchedulingSnapshot, []);
    store.refreshState();
    expect(counts).toEqual([]);
    expect(setCount).not.toHaveBeenCalled();
    sub.unsubscribe();
  });
});
