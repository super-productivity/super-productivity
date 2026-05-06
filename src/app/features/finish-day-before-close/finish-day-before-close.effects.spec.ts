import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { FinishDayBeforeCloseEffects } from './finish-day-before-close.effects';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TaskService } from '../tasks/task.service';
import { WorkContextService } from '../work-context/work-context.service';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { DEFAULT_TASK, Task } from '../tasks/task.model';
import { EMPTY } from 'rxjs';

describe('FinishDayBeforeCloseEffects._handleCloseDecision()', () => {
  let effects: FinishDayBeforeCloseEffects;
  let execBeforeCloseService: jasmine.SpyObj<ExecBeforeCloseService>;
  let confirmDialogSpy: jasmine.Spy;

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

    TestBed.configureTestingModule({
      providers: [
        FinishDayBeforeCloseEffects,
        { provide: ExecBeforeCloseService, useValue: execBeforeCloseServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: DataInitStateService, useValue: dataInitStateServiceSpy },
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
        { provide: TranslateService, useValue: translateServiceSpy },
        { provide: LOCAL_ACTIONS, useValue: EMPTY },
      ],
    });

    effects = TestBed.inject(FinishDayBeforeCloseEffects);
    execBeforeCloseService = TestBed.inject(
      ExecBeforeCloseService,
    ) as jasmine.SpyObj<ExecBeforeCloseService>;

    confirmDialogSpy = spyOn(effects, '_confirm');
  });

  describe('when there are done tasks', () => {
    it('calls setDone (allows close) when user clicks OK', () => {
      confirmDialogSpy.and.returnValue(true);

      effects._handleCloseDecision([doneTask, undoneTask]);

      expect(execBeforeCloseService.setDone).toHaveBeenCalledWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
    });

    it('does NOT close when user clicks Cancel', () => {
      confirmDialogSpy.and.returnValue(false);

      effects._handleCloseDecision([doneTask, undoneTask]);

      expect(execBeforeCloseService.setDone).not.toHaveBeenCalled();
    });
  });

  describe('when there are no done tasks', () => {
    it('calls setDone immediately without showing a dialog', () => {
      effects._handleCloseDecision([undoneTask]);

      expect(confirmDialogSpy).not.toHaveBeenCalled();
      expect(execBeforeCloseService.setDone).toHaveBeenCalledWith(
        'FINISH_DAY_BEFORE_CLOSE_EFFECT',
      );
    });
  });
});
