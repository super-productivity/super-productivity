import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of, Observable } from 'rxjs';
import { FocusModeOverlayComponent } from './focus-mode-overlay.component';
import { TaskService } from '../../tasks/task.service';
import { BannerService } from '../../../core/banner/banner.service';
import { FocusModeService } from '../focus-mode.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { FocusScreen, FocusModeMode } from '../focus-mode.model';
import { cancelFocusSession, hideFocusOverlay } from '../store/focus-mode.actions';
import { BannerId } from '../../../core/banner/banner.model';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  Signal,
} from '@angular/core';

describe('FocusModeOverlayComponent', () => {
  let component: FocusModeOverlayComponent;
  let mockStore: jasmine.SpyObj<Store>;
  let mockBannerService: jasmine.SpyObj<BannerService>;
  let mockFocusModeService: {
    currentScreen: Signal<FocusScreen>;
    isSessionRunning: Signal<boolean>;
    isBreakActive: Signal<boolean>;
    mode: Signal<FocusModeMode>;
    currentCycle: Signal<number>;
    timeToGo$: Observable<number>;
    sessionProgress$: Observable<number>;
  };
  let environmentInjector: EnvironmentInjector;

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['dispatch', 'select']);
    const mockTaskService = jasmine.createSpyObj('TaskService', ['add']);
    mockBannerService = jasmine.createSpyObj('BannerService', ['open', 'dismiss']);
    const mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', ['cfg']);

    mockFocusModeService = {
      currentScreen: signal(FocusScreen.Main),
      isSessionRunning: signal(false),
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
        { provide: BannerService, useValue: mockBannerService },
        { provide: FocusModeService, useValue: mockFocusModeService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
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

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('initialization', () => {
    it('should dismiss focus mode banner on construction', () => {
      expect(mockBannerService.dismiss).toHaveBeenCalledWith(BannerId.FocusMode);
    });

    it('should expose FocusScreen enum', () => {
      expect(component.FocusScreen).toBe(FocusScreen);
    });

    it('should expose T translations', () => {
      expect(component.T).toBeDefined();
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
    it('should dispatch hideFocusOverlay action', () => {
      component.closeOverlay();

      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
    });

    it('should open banner when session is running', () => {
      (mockFocusModeService.isSessionRunning as any).set(true);

      component.closeOverlay();

      expect(mockBannerService.open).toHaveBeenCalled();
      expect(mockStore.dispatch).toHaveBeenCalledWith(hideFocusOverlay());
    });

    it('should open banner when break is active', () => {
      (mockFocusModeService.isBreakActive as any).set(true);

      component.closeOverlay();

      expect(mockBannerService.open).toHaveBeenCalled();
    });

    it('should not open banner when no session or break is active', () => {
      (mockFocusModeService.isSessionRunning as any).set(false);
      (mockFocusModeService.isBreakActive as any).set(false);

      component.closeOverlay();

      expect(mockBannerService.open).not.toHaveBeenCalled();
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
