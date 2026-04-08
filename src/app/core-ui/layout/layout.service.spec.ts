import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { LayoutService } from './layout.service';
import { hideAddTaskBar, showAddTaskBar } from './store/layout.actions';
import { of } from 'rxjs';
import { BreakpointObserver } from '@angular/cdk/layout';
import { NavigationEnd, Router } from '@angular/router';
import { WorkContextService } from '../../features/work-context/work-context.service';

describe('LayoutService', () => {
  let service: LayoutService;
  let mockStore: jasmine.SpyObj<Store>;

  beforeEach(() => {
    const storeSpy = jasmine.createSpyObj('Store', ['dispatch', 'pipe', 'select']);
    const breakpointObserverSpy = jasmine.createSpyObj('BreakpointObserver', ['observe']);
    const routerSpy = jasmine.createSpyObj('Router', [], {
      events: of(new NavigationEnd(0, '/', '/')),
      url: '/',
    });
    const workContextServiceSpy = jasmine.createSpyObj('WorkContextService', [], {
      onWorkContextChange$: of(null),
      activeWorkContext$: of(null),
    });

    // Setup default return values
    storeSpy.pipe.and.returnValue(of(false));
    storeSpy.select.and.returnValue(of({}));
    breakpointObserverSpy.observe.and.returnValue(
      of({ matches: false, breakpoints: {} }),
    );

    TestBed.configureTestingModule({
      providers: [
        LayoutService,
        { provide: Store, useValue: storeSpy },
        { provide: BreakpointObserver, useValue: breakpointObserverSpy },
        { provide: Router, useValue: routerSpy },
        { provide: WorkContextService, useValue: workContextServiceSpy },
      ],
    });

    service = TestBed.inject(LayoutService);
    mockStore = TestBed.inject(Store) as jasmine.SpyObj<Store>;
  });

  describe('Focus restoration', () => {
    let mockTaskElement: HTMLElement;

    beforeEach(() => {
      // Create a mock task element
      mockTaskElement = document.createElement('div');
      mockTaskElement.id = 't-task123';
      mockTaskElement.tabIndex = 0;
      document.body.appendChild(mockTaskElement);
    });

    afterEach(() => {
      if (mockTaskElement && mockTaskElement.parentNode) {
        mockTaskElement.parentNode.removeChild(mockTaskElement);
      }
    });

    it('should store focused task element when showing add task bar', () => {
      // Focus the task element
      Object.defineProperty(document, 'activeElement', {
        value: mockTaskElement,
        writable: true,
      });

      // Show add task bar
      service.showAddTaskBar();

      // Verify the dispatch was called
      expect(mockStore.dispatch).toHaveBeenCalledWith(showAddTaskBar());
    });

    it('should focus newly created task with preventScroll when task id provided', (done) => {
      const newTaskId = 'task-new';
      const newTaskElement = document.createElement('div');
      newTaskElement.id = `t-${newTaskId}`;
      newTaskElement.tabIndex = 0;
      document.body.appendChild(newTaskElement);

      spyOn(newTaskElement, 'focus');

      service.hideAddTaskBar(newTaskId);

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideAddTaskBar());

      setTimeout(() => {
        expect(newTaskElement.focus).toHaveBeenCalledWith({ preventScroll: true });
        document.body.removeChild(newTaskElement);
        done();
      }, 100);
    });

    it('should focus pending task id with preventScroll when hide is called without parameter', (done) => {
      const pendingTaskId = 'pending-task';
      const pendingTaskElement = document.createElement('div');
      pendingTaskElement.id = `t-${pendingTaskId}`;
      pendingTaskElement.tabIndex = 0;
      document.body.appendChild(pendingTaskElement);

      spyOn(pendingTaskElement, 'focus');

      service.setPendingFocusTaskId(pendingTaskId);
      service.hideAddTaskBar();

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideAddTaskBar());

      setTimeout(() => {
        expect(pendingTaskElement.focus).toHaveBeenCalledWith({ preventScroll: true });
        document.body.removeChild(pendingTaskElement);
        done();
      }, 100);
    });

    it('should restore focus to task with preventScroll when hiding add task bar without new task id', (done) => {
      // Spy on focus method
      spyOn(mockTaskElement, 'focus');

      // Set as active element
      Object.defineProperty(document, 'activeElement', {
        value: mockTaskElement,
        writable: true,
      });

      // Show add task bar (which stores the focused element)
      service.showAddTaskBar();

      // Hide add task bar
      service.hideAddTaskBar();

      // Wait for the timeout to restore focus
      setTimeout(() => {
        expect(mockTaskElement.focus).toHaveBeenCalledWith({ preventScroll: true });
        done();
      }, 100);
    });

    it('should not store focus if active element is not a task', (done) => {
      // Spy on focus method
      spyOn(mockTaskElement, 'focus');

      // Create a non-task element
      const nonTaskElement = document.createElement('input');
      nonTaskElement.id = 'some-input';
      document.body.appendChild(nonTaskElement);
      Object.defineProperty(document, 'activeElement', {
        value: nonTaskElement,
        writable: true,
      });

      // Show add task bar
      service.showAddTaskBar();

      // Hide add task bar
      service.hideAddTaskBar();

      // Wait for the timeout
      setTimeout(() => {
        expect(mockTaskElement.focus).not.toHaveBeenCalled();
        document.body.removeChild(nonTaskElement);
        done();
      }, 100);
    });

    it('should not restore focus if element is removed from DOM', (done) => {
      // Spy on focus method
      spyOn(mockTaskElement, 'focus');

      // Set as active element
      Object.defineProperty(document, 'activeElement', {
        value: mockTaskElement,
        writable: true,
      });

      // Show add task bar (which stores the focused element)
      service.showAddTaskBar();

      // Remove element from DOM
      if (mockTaskElement.parentNode) {
        mockTaskElement.parentNode.removeChild(mockTaskElement);
      }

      // Hide add task bar
      service.hideAddTaskBar();

      // Wait for the timeout
      setTimeout(() => {
        expect(mockTaskElement.focus).not.toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should fallback to previously focused task when new task element is missing', (done) => {
      spyOn(mockTaskElement, 'focus');

      Object.defineProperty(document, 'activeElement', {
        value: mockTaskElement,
        writable: true,
      });

      service.showAddTaskBar();

      service.hideAddTaskBar('missing-task');

      setTimeout(() => {
        expect(mockTaskElement.focus).toHaveBeenCalledWith({ preventScroll: true });
        done();
      }, 100);
    });
  });

  describe('scrollToNewTask', () => {
    it('should scroll an existing task into view after a short delay', (done) => {
      const taskId = 'scroll-task';
      const taskElement = document.createElement('div');
      taskElement.id = `t-${taskId}`;
      spyOn(taskElement, 'scrollIntoView');
      document.body.appendChild(taskElement);

      service.scrollToNewTask(taskId);

      setTimeout(() => {
        expect(taskElement.scrollIntoView).toHaveBeenCalledWith({
          behavior: 'instant',
          block: 'center',
          inline: 'nearest',
        });

        document.body.removeChild(taskElement);
        done();
      }, 100);
    });

    it('should do nothing if the task element is missing', (done) => {
      service.scrollToNewTask('missing-task');

      setTimeout(() => {
        expect().nothing();
        done();
      }, 100);
    });
  });
});
