import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateAdapter } from '@angular/material/core';
import { Store } from '@ngrx/store';
import { BehaviorSubject, of } from 'rxjs';
import { DateService } from '../../core/date/date.service';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../root-store/app-state/app-state.selectors';
import { Project } from '../project/project.model';
import { selectUnarchivedProjects } from '../project/store/project.selectors';
import { TaskCopy } from '../tasks/task.model';
import { selectAllTagIds } from '../tag/store/tag.reducer';
import { ViewCriteriaContextService } from './view-criteria-context.service';

describe('ViewCriteriaContextService', () => {
  const todayStr = signal('2026-10-30');
  const startOfNextDayDiffMs = signal(0);
  let projects$: BehaviorSubject<Project[]>;
  const tagIds = signal<string[]>(['t1']);

  const setup = (): ViewCriteriaContextService => {
    projects$ = new BehaviorSubject<Project[]>([
      { id: 'p1', backlogTaskIds: ['inBacklog'], isEnableBacklog: true } as Project,
      { id: 'p2', backlogTaskIds: [] } as unknown as Project,
    ]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Store,
          useValue: {
            selectSignal: (selector: unknown) =>
              selector === selectTodayStr
                ? todayStr
                : selector === selectStartOfNextDayDiffMs
                  ? startOfNextDayDiffMs
                  : selector === selectAllTagIds
                    ? tagIds
                    : signal(undefined),
            select: (selector: unknown) =>
              selector === selectUnarchivedProjects ? projects$ : of([]),
          },
        },
        { provide: DateService, useValue: { todayStr: () => '2000-01-01' } },
        { provide: DateAdapter, useValue: { getFirstDayOfWeek: () => 1 } },
      ],
    });
    return TestBed.inject(ViewCriteriaContextService);
  };

  it('reads the logical day and the day start from the store', () => {
    const service = setup();
    expect(service.ctx().todayStr).toBe('2026-10-30');
    // Monday week start.
    expect(service.ctx().weekStartStr).toBe('2026-10-26');
    todayStr.set('2026-11-02');
    startOfNextDayDiffMs.set(4 * 3600000);
    expect(service.ctx().todayStr).toBe('2026-11-02');
    expect(service.ctx().startOfNextDayDiffMs).toBe(4 * 3600000);
    todayStr.set('2026-10-30');
    startOfNextDayDiffMs.set(0);
  });

  it('knows backlog tasks, through the parent for subtasks', () => {
    const service = setup();
    const ctx = service.ctx();
    expect(ctx.isInBacklog({ id: 'inBacklog' } as TaskCopy)).toBeTrue();
    expect(ctx.isInBacklog({ id: 'sub', parentId: 'inBacklog' } as TaskCopy)).toBeTrue();
    expect(ctx.isInBacklog({ id: 'other' } as TaskCopy)).toBeFalse();
    expect(ctx.isBacklogEnabled('p1')).toBeTrue();
    expect(ctx.isBacklogEnabled('p2')).toBeFalse();
    expect(ctx.isBacklogEnabled('unknown')).toBeFalse();
  });

  it('follows backlog changes without a new context', () => {
    const service = setup();
    const ctx = service.ctx();
    projects$.next([{ id: 'p1', backlogTaskIds: ['other'] } as Project]);
    expect(ctx.isInBacklog({ id: 'other' } as TaskCopy)).toBeTrue();
    expect(ctx.isInBacklog({ id: 'inBacklog' } as TaskCopy)).toBeFalse();
  });

  it('knows the existing tags, apart from the matching context', () => {
    const service = setup();
    const ctx = service.ctx();
    expect(service.tagIdSet().has('t1')).toBeTrue();
    expect(service.tagIdSet().has('t2')).toBeFalse();
    tagIds.set(['t1', 't2']);
    expect(service.tagIdSet().has('t2')).toBeTrue();
    // A new tag doesn't re-match the views.
    expect(service.ctx()).toBe(ctx);
    tagIds.set(['t1']);
  });
});
