import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { Router } from '@angular/router';

import { ReminderCountdownEffects } from './reminder-countdown.effects';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { BannerService } from '../../../core/banner/banner.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { TaskService } from '../../tasks/task.service';
import { ProjectService } from '../../project/project.service';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskWithReminder, DEFAULT_TASK } from '../../tasks/task.model';
import { selectTaskById } from '../../tasks/store/task.selectors';

describe('ReminderCountdownEffects._showBanner', () => {
  let effects: ReminderCountdownEffects;
  let datePipeSpy: jasmine.SpyObj<LocaleDatePipe>;
  let bannerServiceSpy: jasmine.SpyObj<BannerService>;

  const dueWithTime = new Date('2026-04-24T15:00:00Z').getTime(); // 3pm task start
  const THIRTY_MIN_MS = 30 * 60 * 1000;
  const remindAt = dueWithTime - THIRTY_MIN_MS; // reminder fires 30 min before

  const buildTask = (overrides: Partial<TaskWithReminder> = {}): TaskWithReminder =>
    ({
      ...DEFAULT_TASK,
      id: 't1',
      title: 'My Task',
      remindAt,
      dueWithTime,
      ...overrides,
    }) as TaskWithReminder;

  beforeEach(() => {
    datePipeSpy = jasmine.createSpyObj('LocaleDatePipe', ['transform']);
    datePipeSpy.transform.and.callFake((value) => `T(${value})`);

    bannerServiceSpy = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);

    TestBed.configureTestingModule({
      providers: [
        ReminderCountdownEffects,
        provideMockStore({
          selectors: [{ selector: selectTaskById, value: buildTask() }],
        }),
        { provide: LocaleDatePipe, useValue: datePipeSpy },
        { provide: BannerService, useValue: bannerServiceSpy },
        {
          provide: DataInitStateService,
          useValue: { isAllDataLoadedInitially$: EMPTY },
        },
        {
          provide: TaskService,
          useValue: jasmine.createSpyObj('TaskService', ['setCurrentId']),
        },
        {
          provide: ProjectService,
          useValue: jasmine.createSpyObj('ProjectService', ['moveTaskToTodayList']),
        },
        { provide: Router, useValue: { navigate: () => Promise.resolve(true) } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: TranslateStore, useValue: new TranslateStore() },
        { provide: LOCAL_ACTIONS, useValue: of() },
      ],
    });

    effects = TestBed.inject(ReminderCountdownEffects);
  });

  // provideMockStore({ selectors: [...] }) mutates the memoized selector's
  // forced result. That mutation is module-level and leaks across spec files,
  // breaking later specs that call the real projector directly (e.g. task.selectors.spec).
  afterEach(() => {
    TestBed.inject(MockStore).resetSelectors();
  });

  it('renders the banner with the task start time (dueWithTime), not the reminder fire time (remindAt) — #7343', async () => {
    await (effects as any)._showBanner([buildTask()]);

    expect(datePipeSpy.transform).toHaveBeenCalledWith(dueWithTime, 'shortTime');
    expect(datePipeSpy.transform).not.toHaveBeenCalledWith(remindAt, 'shortTime');

    expect(bannerServiceSpy.open).toHaveBeenCalledTimes(1);
    const openArg = bannerServiceSpy.open.calls.mostRecent().args[0];
    expect(openArg.translateParams?.start).toBe(`T(${dueWithTime})`);
    expect(openArg.translateParams?.title).toBe('My Task');
  });

  it('falls back to remindAt when dueWithTime is missing (reminder-only tasks)', async () => {
    const task = buildTask({ dueWithTime: undefined });
    await (effects as any)._showBanner([task]);

    expect(datePipeSpy.transform).toHaveBeenCalledWith(remindAt, 'shortTime');
  });

  it('dismisses the banner when there are no due tasks', async () => {
    await (effects as any)._showBanner([]);

    expect(bannerServiceSpy.dismiss).toHaveBeenCalled();
    expect(bannerServiceSpy.open).not.toHaveBeenCalled();
  });

  it('re-renders when dueWithTime changes even if remindAt stays the same', async () => {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const laterStart = dueWithTime + ONE_HOUR_MS; // task rescheduled 1h later

    await (effects as any)._showBanner([buildTask()]);
    await (effects as any)._showBanner([buildTask({ dueWithTime: laterStart })]);

    expect(bannerServiceSpy.open).toHaveBeenCalledTimes(2);
    const secondOpen = bannerServiceSpy.open.calls.mostRecent().args[0];
    expect(secondOpen.translateParams?.start).toBe(`T(${laterStart})`);
  });
});
