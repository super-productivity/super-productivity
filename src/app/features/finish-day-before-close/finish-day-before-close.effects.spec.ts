import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { FinishDayBeforeCloseEffects } from './finish-day-before-close.effects';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskService } from '../tasks/task.service';
import { WorkContextService } from '../work-context/work-context.service';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { EMPTY } from 'rxjs';

describe('FinishDayBeforeCloseEffects._handleCloseDecision()', () => {
  let effects: FinishDayBeforeCloseEffects;
  let execBeforeCloseService: jasmine.SpyObj<ExecBeforeCloseService>;
  let router: jasmine.SpyObj<Router>;
  let showDialogSpy: jasmine.Spy;

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

    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      misc$: EMPTY,
      appFeatures$: EMPTY,
    });

    const dataInitStateServiceSpy = jasmine.createSpyObj('DataInitStateService', [], {
      isAllDataLoadedInitially$: EMPTY,
    });

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getByIdsLive$']);
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      mainWorkContext$: EMPTY,
    });

    const translateServiceSpy = jasmine.createSpyObj('TranslateService', ['instant']);
    translateServiceSpy.instant.and.returnValue('Finish your day?');

    const routerSpy = jasmine.createSpyObj('Router', ['navigateByUrl']);

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
      ],
    });

    effects = TestBed.inject(FinishDayBeforeCloseEffects);
    execBeforeCloseService = TestBed.inject(
      ExecBeforeCloseService,
    ) as jasmine.SpyObj<ExecBeforeCloseService>;
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;

    showDialogSpy = spyOn(effects, '_showDialog');
  });

  describe('when there are done tasks', () => {
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

    it('navigates to /daily-summary and does NOT close when user picks "finish-day"', async () => {
      showDialogSpy.and.returnValue(Promise.resolve('finish-day'));

      await effects._handleCloseDecision([doneTask, undoneTask]);

      expect(router.navigateByUrl).toHaveBeenCalledWith('/daily-summary');
      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();
    });
  });

  describe('when there are no done tasks', () => {
    it('calls setDone immediately without showing a dialog', async () => {
      await effects._handleCloseDecision([undoneTask]);

      expect(showDialogSpy).not.toHaveBeenCalled();
      expect(execBeforeCloseService.setDone).toHaveBeenCalledWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
