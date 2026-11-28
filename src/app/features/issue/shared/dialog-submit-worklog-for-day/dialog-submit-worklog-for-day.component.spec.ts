import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SnackService } from '../../../../core/snack/snack.service';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { DEFAULT_TASK, Task } from '../../../tasks/task.model';
import { DialogSubmitWorklogForDayComponent } from './dialog-submit-worklog-for-day.component';
import { SubmitWorklogForDayDialogData } from './submit-worklog-for-day-dialog.model';

const DAY = '2026-08-05';
const EARLIER_DAY = '2026-08-04';

describe('DialogSubmitWorklogForDayComponent', () => {
  let data: SubmitWorklogForDayDialogData;
  let close: jasmine.Spy;
  let store: MockStore;

  const createTask = (id: string, issueId: string, ms: number): Task => ({
    ...DEFAULT_TASK,
    id,
    title: id,
    issueId,
    issueProviderId: 'ip1',
    projectId: 'p1',
    timeSpentOnDay: { [DAY]: ms },
  });

  const create = (): DialogSubmitWorklogForDayComponent =>
    runInInjectionContext(
      TestBed.inject(EnvironmentInjector),
      () => new DialogSubmitWorklogForDayComponent(),
    );

  const markedLoggedIds = (): string[] =>
    (store.dispatch as jasmine.Spy).calls
      .allArgs()
      .map(([a]) => a)
      .filter((a) => a.type === TaskSharedActions.updateTask.type)
      .map((a) => a.task.id);

  beforeEach(() => {
    close = jasmine.createSpy('close');
    data = {
      day: DAY,
      providerName: 'GitLab',
      tasks: [createTask('a', '1', 3600000), createTask('b', '2', 1800000)],
      getTimeLogged: jasmine.createSpy('getTimeLogged').and.resolveTo(600000),
      logTime: jasmine.createSpy('logTime').and.resolveTo(),
    };
    TestBed.configureTestingModule({
      imports: [NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        { provide: MAT_DIALOG_DATA, useFactory: () => data },
        { provide: MatDialogRef, useValue: { close } },
        { provide: SnackService, useValue: jasmine.createSpyObj('Snack', ['open']) },
      ],
    });
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');
  });

  it('submits each issue and marks its tracked days as logged', async () => {
    const component = create();
    await component.submit();

    expect(data.logTime).toHaveBeenCalledWith('1', 3600000);
    expect(data.logTime).toHaveBeenCalledWith('2', 1800000);
    expect(store.dispatch).toHaveBeenCalledWith(
      TaskSharedActions.updateTask({
        task: { id: 'a', changes: { issueTimeTracked: { [DAY]: 3600000 } } },
      }),
    );
    expect(markedLoggedIds()).toEqual(['a', 'b']);
    expect(close).toHaveBeenCalled();
  });

  it('keeps the dialog open with only the failed issue when one submit fails', async () => {
    (data.logTime as jasmine.Spy).and.callFake((issueId: string) =>
      issueId === '2' ? Promise.reject(new Error('offline')) : Promise.resolve(),
    );
    const component = create();
    await component.submit();

    expect(markedLoggedIds()).toEqual(['a']);
    expect(component.rows().map((r) => r.taskId)).toEqual(['b']);
    expect(close).not.toHaveBeenCalled();
  });

  it('skips issues with less than a minute to submit', async () => {
    data.tasks = [createTask('a', '1', 3600000), createTask('b', '2', 59000)];
    const component = create();
    await component.submit();

    expect(data.logTime).toHaveBeenCalledTimes(1);
    expect(markedLoggedIds()).toEqual(['a']);
  });

  it('ignores a second submit while the first is in flight', async () => {
    const component = create();
    const first = component.submit();
    await component.submit();
    await first;

    expect(data.logTime).toHaveBeenCalledTimes(2);
  });

  it('submits the edited amount', async () => {
    const component = create();
    component.updateTimeToSubmit('a', 900000);
    await component.submit();

    expect(data.logTime).toHaveBeenCalledWith('1', 900000);
  });

  it('shows the time already logged on the provider', async () => {
    const component = create();
    await (data.getTimeLogged as jasmine.Spy).calls.mostRecent().returnValue;
    await Promise.resolve();

    expect(component.rows().map((r) => r.timeLoggedRemote)).toEqual([600000, 600000]);
  });

  it('renders a row per issue with the other-days hint', async () => {
    data.tasks = [
      createTask('Task A', '1', 3600000),
      {
        ...createTask('Task B', '2', 1800000),
        timeSpentOnDay: { [EARLIER_DAY]: 60000, [DAY]: 1800000 },
      },
    ];
    const fixture = TestBed.createComponent(DialogSubmitWorklogForDayComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const rows = [...el.querySelectorAll('tbody tr')];

    expect(rows.map((r) => r.querySelector('td')?.textContent?.trim())).toEqual([
      'Task A',
      'Task B',
    ]);
    expect(el.querySelectorAll('thead th').length).toBe(3);
    expect(rows[0].querySelector('mat-icon')).toBeNull();
    expect(rows[1].querySelector('mat-icon')?.textContent).toContain('info');
    expect(rows.every((r) => r.querySelector('inline-input'))).toBe(true);
    expect(el.querySelector('mat-dialog-content p')?.innerHTML).toContain(
      'F.ISSUE.DIALOG_SUBMIT_WORKLOG.TOTAL_MSG',
    );
  });
});
