import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { DialogIdleComponent } from './dialog-idle.component';
import { DialogIdlePassedData } from './dialog-idle.model';
import { selectIdleTime } from '../store/idle.selectors';
import { TaskService } from '../../tasks/task.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { Task } from '../../tasks/task.model';
import { WorkContextService } from '../../work-context/work-context.service';
import {
  selectStartableTasksActiveContextFirst,
  selectTrackableTasksActiveContextFirst,
} from '../../work-context/store/work-context.selectors';
import { selectAllProjects } from '../../project/store/project.selectors';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { LS } from '../../../core/persistence/storage-keys.const';

describe('DialogIdleComponent', () => {
  let dialogRefSpy: jasmine.SpyObj<MatDialogRef<DialogIdleComponent>>;

  // selectMode() persists the choice, so reset it to keep tests independent
  beforeEach(() => localStorage.removeItem(LS.LAST_IDLE_DIALOG_MODE));

  const FAKE_TASK = { id: 'LAST_TASK_ID', title: 'Last task' } as Task;
  const IDLE_TIME = 19 * 60 * 1000;
  const ONE_MIN = 60 * 1000;
  const HALF_MIN = 30 * 1000;
  const FIVE_MIN = 5 * ONE_MIN;
  const TEN_MIN = 10 * ONE_MIN;

  const setup = (
    dataOverrides: Partial<DialogIdlePassedData> = {},
    idleTime: number = IDLE_TIME,
  ): DialogIdleComponent => {
    dialogRefSpy = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [DialogIdleComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore(),
        provideNoopAnimations(),
        { provide: MatDialogRef, useValue: dialogRefSpy },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            enabledSimpleStopWatchCounters: [],
            lastCurrentTaskId: null,
            wasFocusSessionRunning: false,
            ...dataOverrides,
          },
        },
        { provide: TaskService, useValue: { getByIdOnce$: () => of(FAKE_TASK) } },
        { provide: WorkContextService, useValue: {} },
        { provide: LayoutService, useValue: { isXs: () => false } },
        {
          provide: GlobalConfigService,
          useValue: {
            takeABreak$: of({ isTakeABreakEnabled: true }),
            shortSyntax: () => ({ isEnableProject: false }),
          },
        },
      ],
    });
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectIdleTime, idleTime);
    store.overrideSelector(selectAllProjects, []);
    store.overrideSelector(selectTrackableTasksActiveContextFirst, []);
    store.overrideSelector(selectStartableTasksActiveContextFirst, []);

    const fixture = TestBed.createComponent(DialogIdleComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  describe('initial state', () => {
    it('should start without a mode and with confirm disabled when there is no last task', () => {
      const c = setup();
      expect(c.mode).toBeNull();
      expect(c.isConfirmEnabled).toBeFalse();
    });

    it('should preselect TASK mode with the last current task', () => {
      const c = setup({ lastCurrentTaskId: 'LAST_TASK_ID' });
      expect(c.mode).toBe('TASK');
      expect(c.selectedTask).toEqual(FAKE_TASK);
      expect(c.isConfirmEnabled).toBeTrue();
    });
  });

  describe('remembered mode', () => {
    it('should persist the selected mode', () => {
      const c = setup();
      c.selectMode('BREAK');
      expect(localStorage.getItem(LS.LAST_IDLE_DIALOG_MODE)).toBe('BREAK');
    });

    it('should preselect the remembered mode when there is no last task', () => {
      localStorage.setItem(LS.LAST_IDLE_DIALOG_MODE, 'SPLIT');
      const c = setup();
      expect(c.mode).toBe('SPLIT');
      expect(c.splitItems.length).toBe(2);
    });

    it('should let a live current task override the remembered mode', () => {
      localStorage.setItem(LS.LAST_IDLE_DIALOG_MODE, 'BREAK');
      const c = setup({ lastCurrentTaskId: 'LAST_TASK_ID' });
      expect(c.mode).toBe('TASK');
    });

    it('should ignore an invalid stored value', () => {
      localStorage.setItem(LS.LAST_IDLE_DIALOG_MODE, 'NONSENSE');
      const c = setup();
      expect(c.mode).toBeNull();
    });
  });

  describe('BREAK mode', () => {
    it('should enable confirm and close with a single break item for the full idle time', () => {
      const c = setup();
      c.selectMode('BREAK');
      expect(c.isConfirmEnabled).toBeTrue();

      c.confirm();
      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({
          isResetBreakTimer: true,
          trackItems: [jasmine.objectContaining({ type: 'BREAK', time: 'IDLE_TIME' })],
        }),
      );
    });
  });

  describe('TASK mode', () => {
    it('should require a task or new task title', () => {
      const c = setup();
      c.selectMode('TASK');
      expect(c.isConfirmEnabled).toBeFalse();

      c.onTaskChange('New task title');
      expect(c.isConfirmEnabled).toBeTrue();
    });

    it('should not enable confirm for a whitespace-only title', () => {
      const c = setup();
      c.selectMode('TASK');
      c.onTaskChange('   ');
      expect(c.isConfirmEnabled).toBeFalse();
    });

    it('should trim the new task title on confirm', () => {
      const c = setup();
      c.selectMode('TASK');
      c.onTaskChange('  New task title  ');
      c.confirm();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({
          trackItems: [jasmine.objectContaining({ title: 'New task title' })],
        }),
      );
    });

    it('should close with a task creation item when a new title was entered', () => {
      const c = setup();
      c.selectMode('TASK');
      c.onTaskChange('New task title');
      c.confirm();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({
          trackItems: [
            jasmine.objectContaining({
              type: 'TASK',
              time: 'IDLE_TIME',
              title: 'New task title',
            }),
          ],
        }),
      );
    });

    it('should close with the selected task', () => {
      const c = setup({ lastCurrentTaskId: 'LAST_TASK_ID' });
      c.confirm();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({
          trackItems: [
            jasmine.objectContaining({
              type: 'TASK',
              time: 'IDLE_TIME',
              task: FAKE_TASK,
            }),
          ],
        }),
      );
    });
  });

  describe('SPLIT mode', () => {
    it('should initialize with a break row and a task row prefilled with the selected task', () => {
      const c = setup({ lastCurrentTaskId: 'LAST_TASK_ID' });
      c.selectMode('SPLIT');

      expect(c.splitItems.length).toBe(2);
      expect(c.splitItems[0].type).toBe('BREAK');
      expect(c.splitItems[1].type).toBe('TASK');
      expect(c.splitItems[1].task).toEqual(FAKE_TASK);
    });

    it('should disable confirm until every row has a time and task rows have a task', () => {
      const c = setup();
      c.selectMode('SPLIT');
      expect(c.isConfirmEnabled).toBeFalse();

      c.splitItems[0].time = FIVE_MIN;
      c.splitItems[1].time = TEN_MIN;
      expect(c.isConfirmEnabled).toBeFalse();

      c.onSplitTaskChange(c.splitItems[1], 'Some task');
      expect(c.isConfirmEnabled).toBeTrue();
    });

    it('should calculate remaining time and assign it to a row', () => {
      const c = setup();
      c.selectMode('SPLIT');
      c.splitItems[0].time = FIVE_MIN;

      expect(c.splitTimeRemaining).toBe(IDLE_TIME - FIVE_MIN);

      c.assignRemainingTime(c.splitItems[1]);
      expect(c.splitItems[1].time).toBe(IDLE_TIME - FIVE_MIN);
      expect(c.splitTimeRemaining).toBe(0);
    });

    it('should report over-assigned time', () => {
      const c = setup();
      c.selectMode('SPLIT');
      c.splitItems[0].time = IDLE_TIME + ONE_MIN;

      expect(c.splitTimeRemaining).toBe(-ONE_MIN);
      expect(c.splitTimeOver).toBe(ONE_MIN);
      expect(c.isSplitOverAssigned).toBeTrue();
      expect(c.isSplitUnderAssigned).toBeFalse();
    });

    it('should treat sub-minute remainders as fully assigned', () => {
      const c = setup();
      c.selectMode('SPLIT');
      c.splitItems[0].time = IDLE_TIME - HALF_MIN;

      expect(c.isSplitUnderAssigned).toBeFalse();
      expect(c.isSplitOverAssigned).toBeFalse();
    });

    it('should close with all split items', () => {
      const c = setup();
      c.selectMode('SPLIT');
      c.splitItems[0].time = FIVE_MIN;
      c.splitItems[1].time = TEN_MIN;
      c.onSplitTaskChange(c.splitItems[1], 'Some task');
      c.confirm();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({
          trackItems: [
            jasmine.objectContaining({ type: 'BREAK', time: FIVE_MIN }),
            jasmine.objectContaining({
              type: 'TASK',
              time: TEN_MIN,
              title: 'Some task',
            }),
          ],
        }),
      );
    });

    it('should re-seed pristine rows with the latest task selection on re-entry', () => {
      const OTHER_TASK = { id: 'OTHER_TASK_ID', title: 'Other task' } as Task;
      const c = setup({ lastCurrentTaskId: 'LAST_TASK_ID' });
      c.selectMode('SPLIT');
      expect(c.splitItems[1].task).toEqual(FAKE_TASK);

      c.selectMode('TASK');
      c.onTaskChange(OTHER_TASK);
      c.selectMode('SPLIT');
      expect(c.splitItems[1].task).toEqual(OTHER_TASK);
    });

    it('should keep rows with user-entered times on re-entry', () => {
      const OTHER_TASK = { id: 'OTHER_TASK_ID', title: 'Other task' } as Task;
      const c = setup({ lastCurrentTaskId: 'LAST_TASK_ID' });
      c.selectMode('SPLIT');
      c.splitItems[0].time = FIVE_MIN;

      c.selectMode('TASK');
      c.onTaskChange(OTHER_TASK);
      c.selectMode('SPLIT');
      expect(c.splitItems[0].time).toBe(FIVE_MIN);
      expect(c.splitItems[1].task).toEqual(FAKE_TASK);
    });

    it('should not remove the last remaining row via validation guard', () => {
      const c = setup();
      c.selectMode('SPLIT');
      c.removeSplitItem(c.splitItems[0]);
      expect(c.splitItems.length).toBe(1);
    });
  });

  describe('reset break timer default', () => {
    it('should auto-check for break-containing modes and uncheck otherwise', () => {
      const c = setup();
      expect(c.isResetBreakTimer).toBeFalse();

      c.selectMode('BREAK');
      expect(c.isResetBreakTimer).toBeTrue();

      c.selectMode('TASK');
      expect(c.isResetBreakTimer).toBeFalse();

      c.selectMode('SPLIT');
      expect(c.isResetBreakTimer).toBeTrue();
    });

    it('should stop auto-managing once the user changed it manually', () => {
      const c = setup();
      c.onResetBreakTimerChange(true);
      c.selectMode('TASK');
      expect(c.isResetBreakTimer).toBeTrue();

      c.selectMode('BREAK');
      c.onResetBreakTimerChange(false);
      c.selectMode('SPLIT');
      expect(c.isResetBreakTimer).toBeFalse();
    });
  });

  describe('skip', () => {
    it('should close with no track items but pass the simple counter state', () => {
      const c = setup();
      c.skipTrack();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({
          trackItems: [],
          simpleCounterToggleBtnsWhenNoTrackItems: c.simpleCounterToggleBtns,
        }),
      );
    });

    it('should not request a break timer reset when the checkbox was only auto-checked', () => {
      const c = setup();
      c.selectMode('BREAK');
      expect(c.isResetBreakTimer).toBeTrue();

      c.skipTrack();
      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ isResetBreakTimer: false, trackItems: [] }),
      );
    });

    it('should keep an explicit reset choice', () => {
      const c = setup();
      c.onResetBreakTimerChange(true);
      c.skipTrack();

      expect(dialogRefSpy.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ isResetBreakTimer: true, trackItems: [] }),
      );
    });
  });
});
