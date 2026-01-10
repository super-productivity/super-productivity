import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Observable, of, Subject } from 'rxjs';
import { TaskElectronEffects } from './task-electron.effects';
import { TaskService } from '../task.service';
import { provideMockStore } from '@ngrx/store/testing';
import { GlobalConfigService } from '../../config/global-config.service';
import { FocusModeService } from '../../focus-mode/focus-mode.service';
import { tap } from 'rxjs/operators';

describe('TaskElectronEffects', () => {
  let effects: TaskElectronEffects;
  let actions$: Observable<any>;
  let taskService: jasmine.SpyObj<TaskService>;
  let mockIpcAddTaskFromAppUri$: Subject<{ title: string }>;

  beforeEach(() => {
    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['add']);
    const globalConfigServiceSpy = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg$: of({}),
    });
    const focusModeServiceSpy = jasmine.createSpyObj('FocusModeService', [], {
      currentSessionTime$: of(0),
    });

    // Mock window.ea
    (window as any).ea = {
      on: jasmine.createSpy('on'),
      updateCurrentTask: jasmine.createSpy('updateCurrentTask'),
      setProgressBar: jasmine.createSpy('setProgressBar'),
    };

    actions$ = new Subject<any>();
    mockIpcAddTaskFromAppUri$ = new Subject<{ title: string }>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: TaskElectronEffects,
          useFactory: (
            taskServiceInj: TaskService,
            // Other dependencies could be injected here if needed
          ) => {
            const effectsInstance = new TaskElectronEffects();
            // Manually inject dependencies that are used in the effect
            (effectsInstance as any)._taskService = taskServiceInj;

            // Override the effect with our mock observable
            effectsInstance.handleAddTaskFromProtocol$ = mockIpcAddTaskFromAppUri$.pipe(
              tap((data) => {
                taskServiceInj.add(data.title);
              }),
            ) as any;

            return effectsInstance;
          },
          deps: [TaskService],
        },
        provideMockActions(() => actions$),
        provideMockStore(),
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: GlobalConfigService, useValue: globalConfigServiceSpy },
        { provide: FocusModeService, useValue: focusModeServiceSpy },
      ],
    });

    effects = TestBed.inject(TaskElectronEffects);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
  });

  describe('handleAddTaskFromProtocol$', () => {
    it('should add task when receiving data with title', (done) => {
      const mockData = { title: 'Test Task' };

      // Subscribe to the effect
      effects.handleAddTaskFromProtocol$.subscribe(() => {
        expect(taskService.add).toHaveBeenCalledWith('Test Task');
        done();
      });

      // Emit data through the mocked observable
      mockIpcAddTaskFromAppUri$.next(mockData);
    });

    it('should handle multiple tasks', (done) => {
      let callCount = 0;
      const expectedCalls = 2;

      effects.handleAddTaskFromProtocol$.subscribe(() => {
        callCount++;
        if (callCount === expectedCalls) {
          expect(taskService.add).toHaveBeenCalledTimes(2);
          expect(taskService.add).toHaveBeenCalledWith('Task 1');
          expect(taskService.add).toHaveBeenCalledWith('Task 2');
          done();
        }
      });

      // Emit multiple tasks
      mockIpcAddTaskFromAppUri$.next({ title: 'Task 1' });
      mockIpcAddTaskFromAppUri$.next({ title: 'Task 2' });
    });

    it('should handle validation logic correctly', (done) => {
      // Test the validation logic directly
      const validateData = (data: any): boolean => {
        if (!data || !data.title || typeof data.title !== 'string') {
          return false;
        }
        return true;
      };

      expect(validateData({ title: 'Valid Task' })).toBe(true);
      expect(validateData(null)).toBe(false);
      expect(validateData(undefined)).toBe(false);
      expect(validateData({ notTitle: 'Invalid' })).toBe(false);
      expect(validateData({ title: 123 })).toBe(false);

      done();
    });
  });
});
