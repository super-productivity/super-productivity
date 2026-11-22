import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { FinishDayBeforeCloseEffects } from './finish-day-before-close.effects';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskService } from '../tasks/task.service';
import { WorkContextService } from '../work-context/work-context.service';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { BehaviorSubject, EMPTY, of, Subject } from 'rxjs';

describe('FinishDayBeforeCloseEffects._handleCloseDecision()', () => {
  let effects: FinishDayBeforeCloseEffects;
  let execBeforeCloseService: jasmine.SpyObj<ExecBeforeCloseService>;
  let router: jasmine.SpyObj<Router>;
  let showDialogSpy: jasmine.Spy;
  let uiHelperService: jasmine.SpyObj<UiHelperService>;
  let misc$: BehaviorSubject<{ isConfirmBeforeExitWithoutFinishDay: boolean }>;

  const doneTask: Task = {
    ...DEFAULT_TASK,
    projectId: 'p1',
    id: 'task-done',
    isDone: true,
  };
  const undoneTask: Task = {
    ...DEFAULT_TASK,
    projectId: 'p1',
    id: 'task-undone',
    isDone: false,
  };

  beforeEach(() => {
    const execBeforeCloseServiceSpy = jasmine.createSpyObj('ExecBeforeCloseService', [
      'schedule',
      'unschedule',
      'setDone',
    ]);
    execBeforeCloseServiceSpy.onBeforeClose$ = EMPTY;

    misc$ = new BehaviorSubject<{ isConfirmBeforeExitWithoutFinishDay: boolean }>({
      isConfirmBeforeExitWithoutFinishDay: true,
    });
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      misc$,
      appFeatures$: of({ isFinishDayEnabled: true }),
    });

    const dataInitStateServiceSpy = jasmine.createSpyObj('DataInitStateService', [], {
      isAllDataLoadedInitially$: of(undefined),
    });

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getByIdsLive$']);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      mainWorkContext$: EMPTY,
    });

    const translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    translateServiceSpy.instant.and.returnValue('Finish your day?');

    const routerSpy = jasmine.createSpyObj('Router', ['navigateByUrl']);
    const uiHelperServiceSpy = jasmine.createSpyObj('UiHelperService', ['focusApp']);

    TestBed.configureTestingModule({
      providers: [
        FinishDayBeforeCloseEffects,
        { provide: ExecBeforeCloseService, useValue: execBeforeCloseServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: DataInitStateService, useValue: dataInitStateServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: UiHelperService, useValue: uiHelperServiceSpy },
      ],
    });

    effects = TestBed.inject(FinishDayBeforeCloseEffects);
    execBeforeCloseService = TestBed.inject(
      ExecBeforeCloseService,
    ) as jasmine.SpyObj<ExecBeforeCloseService>;
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    uiHelperService = TestBed.inject(UiHelperService) as jasmine.SpyObj<UiHelperService>;

    showDialogSpy = spyOn(effects, '_showDialog');
  });

  describe('when there are done tasks', () => {
    // Quit from the tray leaves the window hidden; an unseen prompt stalls the quit.
    it('shows the app window before the prompt', async () => {
      showDialogSpy.and.callFake(() => {
        expect(uiHelperService.focusApp).toHaveBeenCalled();
        return Promise.resolve('quit');
      });

      await effects._handleCloseDecision([doneTask]);

      expect(showDialogSpy).toHaveBeenCalled();
    });

    it('calls setDone (allows close) when user picks "quit"', async () => {
      showDialogSpy.and.returnValue(Promise.resolve('quit'));

      await effects._handleCloseDecision([doneTask, undoneTask]);

      expect(execBeforeCloseService.setDone).toHaveBeenCalledWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('does NOT close and does NOT navigate when user picks "cancel"', async () => {
      showDialogSpy.and.returnValue(Promise.resolve('cancel'));

      await effects._handleCloseDecision([doneTask, undoneTask]);

      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('navigates to /active/daily-summary and does NOT close when user picks "finish-day"', async () => {
      showDialogSpy.and.returnValue(Promise.resolve('finish-day'));

      await effects._handleCloseDecision([doneTask, undoneTask]);

      // Must target the context-resolved route (issue #8449); a bare
      // `/daily-summary` has no matching route and redirects to the start page.
      expect(router.navigateByUrl).toHaveBeenCalledWith('/active/daily-summary');
      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();
    });
  });

  it('a repeated quit while the prompt is open shows no second prompt', async () => {
    let answer: (choice: 'quit') => void = () => undefined;
    showDialogSpy.and.returnValue(new Promise((resolve) => (answer = resolve)));

    const first = effects._handleCloseDecision([doneTask]);
    await effects._handleCloseDecision([doneTask]);

    expect(showDialogSpy).toHaveBeenCalledTimes(1);
    expect(uiHelperService.focusApp).toHaveBeenCalledTimes(2);
    expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();

    answer('quit');
    await first;
    expect(execBeforeCloseService.setDone).toHaveBeenCalledOnceWith(
      'FINISH_DAY_BEFORE_CLOSE_EFFECT',
    );
  });

  describe('_warnOnRequest$()', () => {
    let requests$: Subject<string[]>;

    beforeEach(() => {
      const workContextService = TestBed.inject(WorkContextService);
      Object.defineProperty(workContextService, 'mainWorkContext$', {
        value: of({ taskIds: [doneTask.id] }),
      });
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.getByIdsLive$.and.returnValue(of([doneTask]));
      requests$ = new Subject<string[]>();
    });

    it('prompts only for requests carrying its id', () => {
      const handleSpy = spyOn(effects, '_handleCloseDecision').and.resolveTo();
      const sub = effects._warnOnRequest$(requests$).subscribe();

      // The main process re-notifies the sync hold alone once this one is done.
      requests$.next(['SYNC_BEFORE_CLOSE_ID']);
      expect(handleSpy).not.toHaveBeenCalled();

      requests$.next(['FINISH_DAY_BEFORE_CLOSE_EFFECT', 'SYNC_BEFORE_CLOSE_ID']);
      expect(handleSpy).toHaveBeenCalledOnceWith([doneTask]);
      sub.unsubscribe();
    });

    it('acknowledges a queued request after confirmation is disabled', () => {
      const handleSpy = spyOn(effects, '_handleCloseDecision').and.resolveTo();
      const sub = effects._warnOnRequest$(requests$).subscribe();

      misc$.next({ isConfirmBeforeExitWithoutFinishDay: false });
      requests$.next(['SYNC_BEFORE_CLOSE_ID']);
      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();

      requests$.next(['FINISH_DAY_BEFORE_CLOSE_EFFECT', 'SYNC_BEFORE_CLOSE_ID']);
      expect(execBeforeCloseService.setDone).toHaveBeenCalledOnceWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
      expect(handleSpy).not.toHaveBeenCalled();
      sub.unsubscribe();
    });

    it('acknowledges the request if confirmation is disabled while tasks are loading', () => {
      const tasks$ = new Subject<Task[]>();
      const taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
      taskService.getByIdsLive$.and.returnValue(tasks$);
      const handleSpy = spyOn(effects, '_handleCloseDecision').and.resolveTo();
      const sub = effects._warnOnRequest$(requests$).subscribe();

      requests$.next(['FINISH_DAY_BEFORE_CLOSE_EFFECT', 'SYNC_BEFORE_CLOSE_ID']);
      misc$.next({ isConfirmBeforeExitWithoutFinishDay: false });
      expect(execBeforeCloseService.setDone).toHaveBeenCalledOnceWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );

      tasks$.next([doneTask]);
      expect(handleSpy).not.toHaveBeenCalled();
      sub.unsubscribe();
    });

    it('keeps an open prompt in control after confirmation is disabled', async () => {
      let answer: (choice: 'cancel') => void = () => undefined;
      showDialogSpy.and.returnValue(new Promise((resolve) => (answer = resolve)));
      const sub = effects._warnOnRequest$(requests$).subscribe();
      const holdStates: boolean[] = [];
      sub.add(
        effects.requiresConfirmationHold$.subscribe((state) => holdStates.push(state)),
      );
      const request = ['FINISH_DAY_BEFORE_CLOSE_EFFECT', 'SYNC_BEFORE_CLOSE_ID'];

      requests$.next(request);
      misc$.next({ isConfirmBeforeExitWithoutFinishDay: false });
      requests$.next(request);

      expect(showDialogSpy).toHaveBeenCalledTimes(1);
      expect(uiHelperService.focusApp).toHaveBeenCalledTimes(2);
      expect(holdStates).toEqual([true]);
      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();

      answer('cancel');
      await Promise.resolve();
      expect(holdStates).toEqual([true, false]);
      requests$.next(request);
      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();

      misc$.next({ isConfirmBeforeExitWithoutFinishDay: true });
      misc$.next({ isConfirmBeforeExitWithoutFinishDay: false });
      requests$.next(request);
      expect(execBeforeCloseService.setDone).toHaveBeenCalledOnceWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
      sub.unsubscribe();
    });
  });

  // Finish Day archives won't-do tasks as well.
  it("counts tasks finished as won't do", async () => {
    showDialogSpy.and.returnValue(Promise.resolve('cancel'));

    await effects._handleCloseDecision([
      { ...doneTask, doneOn: 5, wontDoOn: 5 },
      undoneTask,
    ]);

    expect(showDialogSpy).toHaveBeenCalledWith(1);
  });

  describe('when there are no done tasks', () => {
    it('calls setDone immediately without showing a dialog', async () => {
      await effects._handleCloseDecision([undoneTask]);

      expect(showDialogSpy).not.toHaveBeenCalled();
      expect(uiHelperService.focusApp).not.toHaveBeenCalled();
      expect(execBeforeCloseService.setDone).toHaveBeenCalledWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
