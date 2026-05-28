import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of, Observable } from 'rxjs';
import { FocusModeOverlayComponent } from './focus-mode-overlay.component';
import { TaskService } from '../../tasks/task.service';
import { FocusModeService } from '../focus-mode.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { FocusScreen, FocusModeMode } from '../focus-mode.model';
import { cancelFocusSession, hideFocusOverlay } from '../store/focus-mode.actions';
import { MatDialog } from '@angular/material/dialog';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  WritableSignal,
} from '@angular/core';

describe('FocusModeOverlayComponent', () => {
  let component: FocusModeOverlayComponent;
  let mockStore: jasmine.SpyObj<Store>;
  let mockMatDialog: { openDialogs: unknown[] };
  let mockFocusModeService: {
    currentScreen: WritableSignal<FocusScreen>;
    isSessionRunning: WritableSignal<boolean>;
    isSessionPaused: WritableSignal<boolean>;
    isBreakActive: WritableSignal<boolean>;
    mode: WritableSignal<FocusModeMode>;
    currentCycle: WritableSignal<number>;
    timeToGo$: Observable<number>;
    sessionProgress$: Observable<number>;
  };
  let environmentInjector: EnvironmentInjector;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    const mockTaskService = jasmine.createSpyObj('TaskService', ['add']);
    const mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', ['cfg']);
    mockMatDialog = { openDialogs: [] };

    mockFocusModeService = {
      currentScreen: signal(FocusScreen.Main),
      isSessionRunning: signal(false),
      isSessionPaused: signal(false),
      isBreakActive: signal(false),
      mode: signal(FocusModeMode.Pomodoro),
      currentCycle: signal(1),
      timeToGo$: of(300000),
      sessionProgress$: of(0),
    };

    mockStore.select.and.returnValue(of(0));

    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: mockStore },
        { provide: TaskService, useValue: mockTaskService },
        { provide: FocusModeService, useValue: mockFocusModeService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);

    runInInjectionContext(environmentInjector, () => {
      component = new FocusModeOverlayComponent();
    });
  });

  afterEach(() => {
    if (component) {
      component.ngOnDestroy();
    }
  });

  describe('initialization', () => {
    it('should expose FocusScreen enum', () => {
      expect(component.FocusScreen).toBe(FocusScreen);
    });

    it('should have activePage signal from service', () => {
      expect(component.activePage()).toBe(FocusScreen.Main);
    });

    it('should have isSessionRunning signal from service', () => {
      expect(component.isSessionRunning()).toBe(false);
    });
  });

  describe('cancelFocusSession', () => {
    it('should dispatch cancelFocusSession action', () => {
      component.cancelFocusSession();

      expect(mockStore.dispatch).toHaveBeenCalledWith(cancelFocusSession());
    });
  });

  describe('closeOverlay', () => {
    // The header focus-button indicator now takes over once the overlay is
    // hidden mid-session — closeOverlay just dispatches hideFocusOverlay()
    // and the indicator surfaces automatically via isOverlayShown flipping.
    it('should dispatch hideFocusOverlay action', () => {
      component.closeOverlay();

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
    });

    it('should dispatch hideFocusOverlay regardless of session state', () => {
      mockFocusModeService.isSessionRunning.set(true);

      component.closeOverlay();

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
    });
  });

  describe('keyboard handling', () => {
    const dispatchKeydown = (event: KeyboardEvent): KeyboardEvent => {
      document.dispatchEvent(event);
      return event;
    };

    it('should close the overlay when Escape is pressed', () => {
      const event = dispatchKeydown(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(event.defaultPrevented).toBe(true);
      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
    });

    it('should only hide the overlay on Escape while a session is running', () => {
      mockFocusModeService.isSessionRunning.set(true);

      dispatchKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
      expect(mockStore.dispatch).not.toHaveBeenCalledWith(cancelFocusSession());
    });

    it('should not handle non-Escape keys', () => {
      dispatchKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('should not handle Escape if another component already handled it', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();

      dispatchKeydown(event);

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('should not close the overlay while a dialog is open', () => {
      mockMatDialog.openDialogs = [{}];

      dispatchKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it('should not close the overlay when Escape comes from an input', () => {
      const input = document.createElement('textarea');
      document.body.appendChild(input);

      try {
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
          }),
        );
      } finally {
        input.remove();
      }

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('back', () => {
    it('should call window.history.back', () => {
      const historySpy = spyOn(window.history, 'back');

      component.back();

      expect(historySpy).toHaveBeenCalled();
    });
  });

  describe('ngOnDestroy', () => {
    it('should complete onDestroy subject', () => {
      const destroySpy = spyOn(component['_onDestroy$'], 'next');
      const completeSpy = spyOn(component['_onDestroy$'], 'complete');

      component.ngOnDestroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });
  });
});
