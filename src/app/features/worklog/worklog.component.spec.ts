import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';

import { TranslateModule } from '@ngx-translate/core';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { BehaviorSubject, of } from 'rxjs';

import { Worklog } from './worklog.model';
import { WorklogComponent } from './worklog.component';
import { WorklogService } from './worklog.service';
import { WorkContextService } from '../work-context/work-context.service';
import { TaskArchiveService } from '../archive/task-archive.service';
import { TaskService } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { selectAllProjectColorsAndTitles } from '../project/store/project.selectors';
import { mapArchiveToWorklog } from './util/map-archive-to-worklog';

describe('WorklogComponent', () => {
  let fixture: ComponentFixture<WorklogComponent>;

  const worklogData$ = new BehaviorSubject({
    worklog: {} as Worklog,
    totalTimeSpent: 0,
  });

  const createTaskForDate = (dateStr: string, timeSpent = 60000): Task => ({
    attachments: [],
    created: new Date(dateStr).getTime(),
    id: dateStr,
    isDone: false,
    projectId: 'project',
    subTaskIds: [],
    tagIds: [],
    timeEstimate: 0,
    timeSpent,
    timeSpentOnDay: { [dateStr]: timeSpent },
    title: dateStr,
  });

  beforeEach(async () => {
    const activatedRouteSpy = jasmine.createSpyObj<ActivatedRoute>('ActivatedRoute', [], {
      queryParams: of(),
    });
    const worklogServiceSpy = jasmine.createSpyObj<WorklogService>('WorklogService', [], {
      worklogData$,
    });

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), WorklogComponent],
      providers: [
        provideMockStore({
          selectors: [
            {
              selector: selectAllProjectColorsAndTitles,
              value: [],
            },
          ],
        }),
        provideMockActions(of()),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: activatedRouteSpy },
        { provide: TaskArchiveService, useValue: {} },
        { provide: TaskService, useValue: {} },
        { provide: WorkContextService, useValue: {} },
        { provide: WorklogService, useValue: worklogServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorklogComponent);
    fixture.detectChanges();
  });

  it('arranges month data in reverse chronological order from top to bottom', () => {
    const tasks = [
      createTaskForDate('2025-01-01'),
      createTaskForDate('2025-02-01'),
      createTaskForDate('2025-03-01'),
      createTaskForDate('2025-10-01'),
      createTaskForDate('2025-11-01'),
      createTaskForDate('2025-12-01'),
    ];

    worklogData$.next(
      mapArchiveToWorklog(
        {
          ids: tasks.map((task) => task.id),
          entities: tasks.reduce(
            (entities, task) => ({ ...entities, [task.id]: task }),
            {},
          ),
        },
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      ),
    );
    fixture.detectChanges();

    const monthTitles = fixture.debugElement
      .queryAll(By.css('.month-title > span'))
      .map((de) => de.nativeElement.textContent.trim());

    expect(monthTitles).toEqual([
      'December',
      'November',
      'October',
      'March',
      'February',
      'January',
    ]);
  });

  it('arranges day data in chronological order from top to bottom', () => {
    const tasks = [
      createTaskForDate('2025-01-01'),
      createTaskForDate('2025-01-02'),
      createTaskForDate('2025-01-03'),
    ];

    worklogData$.next(
      mapArchiveToWorklog(
        {
          ids: tasks.map((task) => task.id),
          entities: tasks.reduce(
            (entities, task) => ({ ...entities, [task.id]: task }),
            {},
          ),
        },
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      ),
    );
    fixture.detectChanges();

    const dayLabels = fixture.debugElement
      .queryAll(By.css('.week-row td:first-child'))
      .map((de) => de.nativeElement.textContent.trim());

    expect(dayLabels).toEqual(['Wed 1.', 'Thu 2.', 'Fri 3.']);
  });
});
