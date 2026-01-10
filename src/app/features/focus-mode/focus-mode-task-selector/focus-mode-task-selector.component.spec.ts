import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { FocusModeTaskSelectorComponent } from './focus-mode-task-selector.component';
import { TaskService } from '../../tasks/task.service';

describe('FocusModeTaskSelectorComponent', () => {
  let component: FocusModeTaskSelectorComponent;
  let mockTaskService: jasmine.SpyObj<TaskService>;
  let environmentInjector: EnvironmentInjector;

  beforeEach(() => {
    mockTaskService = jasmine.createSpyObj('TaskService', ['add']);
    mockTaskService.add.and.returnValue('new-task-id');

    TestBed.configureTestingModule({
      providers: [{ provide: TaskService, useValue: mockTaskService }],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);

    runInInjectionContext(environmentInjector, () => {
      component = new FocusModeTaskSelectorComponent();
    });
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should initialize currentTaskInputText as empty string', () => {
      expect(component.currentTaskInputText()).toBe('');
    });

    it('should have taskSelected output', () => {
      expect(component.taskSelected).toBeDefined();
    });

    it('should have closed output', () => {
      expect(component.closed).toBeDefined();
    });
  });

  describe('onTaskChange', () => {
    it('should set currentTaskInputText when receiving a string', () => {
      component.onTaskChange('New task title');

      expect(component.currentTaskInputText()).toBe('New task title');
    });

    it('should emit taskSelected and clear input when receiving a task object', () => {
      const taskSelectedSpy = spyOn(component.taskSelected, 'emit');
      const mockTask = { id: 'task-123', title: 'Test Task' } as any;

      component.onTaskChange(mockTask);

      expect(taskSelectedSpy).toHaveBeenCalledWith('task-123');
      expect(component.currentTaskInputText()).toBe('');
    });

    it('should not emit when receiving null', () => {
      const taskSelectedSpy = spyOn(component.taskSelected, 'emit');

      component.onTaskChange(null);

      expect(taskSelectedSpy).not.toHaveBeenCalled();
    });
  });

  describe('createAndSelectTaskFromInput', () => {
    it('should create task and emit taskSelected when input has text', () => {
      const taskSelectedSpy = spyOn(component.taskSelected, 'emit');
      component.currentTaskInputText.set('New task');

      component.createAndSelectTaskFromInput();

      expect(mockTaskService.add).toHaveBeenCalledWith('New task', false, {});
      expect(taskSelectedSpy).toHaveBeenCalledWith('new-task-id');
      expect(component.currentTaskInputText()).toBe('');
    });

    it('should not create task when input is empty', () => {
      const taskSelectedSpy = spyOn(component.taskSelected, 'emit');
      component.currentTaskInputText.set('');

      component.createAndSelectTaskFromInput();

      expect(mockTaskService.add).not.toHaveBeenCalled();
      expect(taskSelectedSpy).not.toHaveBeenCalled();
    });

    it('should not create task when input contains only whitespace', () => {
      const taskSelectedSpy = spyOn(component.taskSelected, 'emit');
      component.currentTaskInputText.set('   ');

      component.createAndSelectTaskFromInput();

      expect(mockTaskService.add).not.toHaveBeenCalled();
      expect(taskSelectedSpy).not.toHaveBeenCalled();
    });

    it('should trim whitespace from task title', () => {
      component.currentTaskInputText.set('  Task with spaces  ');

      component.createAndSelectTaskFromInput();

      expect(mockTaskService.add).toHaveBeenCalledWith('Task with spaces', false, {});
    });
  });

  describe('close', () => {
    it('should emit closed event', () => {
      const closedSpy = spyOn(component.closed, 'emit');

      component.close();

      expect(closedSpy).toHaveBeenCalled();
    });
  });

  describe('onKeyDown', () => {
    it('should call close when Escape is pressed', () => {
      const closedSpy = spyOn(component.closed, 'emit');
      const event = new KeyboardEvent('keydown', { key: 'Escape' });

      component.onKeyDown(event);

      expect(closedSpy).toHaveBeenCalled();
    });

    it('should not close for other keys', () => {
      const closedSpy = spyOn(component.closed, 'emit');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });

      component.onKeyDown(event);

      expect(closedSpy).not.toHaveBeenCalled();
    });
  });

  describe('handleEnter', () => {
    it('should call createAndSelectTaskFromInput when in create mode', () => {
      const createSpy = spyOn(component, 'createAndSelectTaskFromInput');
      component.selectTaskComponent = {
        isInCreateMode: () => true,
      } as any;
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      const preventDefaultSpy = spyOn(event, 'preventDefault');

      component.handleEnter(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalled();
    });

    it('should not call createAndSelectTaskFromInput when not in create mode', () => {
      const createSpy = spyOn(component, 'createAndSelectTaskFromInput');
      component.selectTaskComponent = {
        isInCreateMode: () => false,
      } as any;
      const event = new KeyboardEvent('keydown', { key: 'Enter' });

      component.handleEnter(event);

      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should not call createAndSelectTaskFromInput when selectTaskComponent is undefined', () => {
      const createSpy = spyOn(component, 'createAndSelectTaskFromInput');
      component.selectTaskComponent = undefined;
      const event = new KeyboardEvent('keydown', { key: 'Enter' });

      component.handleEnter(event);

      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
