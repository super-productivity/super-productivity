import { TestBed } from '@angular/core/testing';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  WritableSignal,
} from '@angular/core';
import { Subject } from 'rxjs';

import { OnboardingPresetSelectionComponent } from './onboarding-preset-selection.component';
import { ONBOARDING_PRESETS } from './onboarding-presets.const';
import { GlobalConfigService } from '../config/global-config.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { LS } from '../../core/persistence/storage-keys.const';

describe('OnboardingPresetSelectionComponent', () => {
  let component: OnboardingPresetSelectionComponent;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let cfgSignal: WritableSignal<{ sync: { isEnabled: boolean } }>;
  let afterClosed$: Subject<void>;

  const setup = (): void => {
    cfgSignal = signal({ sync: { isEnabled: false } });
    afterClosed$ = new Subject<void>();

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockDialog.open.and.returnValue({
      afterClosed: () => afterClosed$.asObservable(),
    } as unknown as MatDialogRef<unknown>);

    const mockGlobalConfig = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg: cfgSignal,
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialog, useValue: mockDialog },
        { provide: GlobalConfigService, useValue: mockGlobalConfig },
      ],
    });

    runInInjectionContext(TestBed.inject(EnvironmentInjector), () => {
      component = new OnboardingPresetSelectionComponent();
    });
  };

  beforeEach(() => {
    localStorage.removeItem(LS.ONBOARDING_PRESET_DONE);
    localStorage.removeItem(LS.ONBOARDING_HINTS_DONE);
    setup();
  });

  afterEach(() => {
    localStorage.removeItem(LS.ONBOARDING_PRESET_DONE);
    localStorage.removeItem(LS.ONBOARDING_HINTS_DONE);
  });

  describe('setupSync', () => {
    it('opens the sync config dialog', async () => {
      await component.setupSync();
      expect(mockDialog.open).toHaveBeenCalledTimes(1);
    });

    it('does nothing once a preset has been selected', async () => {
      component.selectedPreset.set(ONBOARDING_PRESETS[0]);
      await component.setupSync();
      expect(mockDialog.open).not.toHaveBeenCalled();
    });

    it('dismisses onboarding when sync was enabled in the dialog', async () => {
      let dismissedCount = 0;
      component.dismissed.subscribe(() => dismissedCount++);

      await component.setupSync();
      expect(dismissedCount).toBe(0);
      expect(localStorage.getItem(LS.ONBOARDING_PRESET_DONE)).toBeNull();

      cfgSignal.set({ sync: { isEnabled: true } });
      afterClosed$.next();

      expect(dismissedCount).toBe(1);
      expect(localStorage.getItem(LS.ONBOARDING_PRESET_DONE)).toBe('true');
      expect(localStorage.getItem(LS.ONBOARDING_HINTS_DONE)).toBe('true');
    });

    it('keeps onboarding open when sync was not enabled (dialog cancelled)', async () => {
      let dismissedCount = 0;
      component.dismissed.subscribe(() => dismissedCount++);

      await component.setupSync();
      afterClosed$.next();

      expect(dismissedCount).toBe(0);
      expect(localStorage.getItem(LS.ONBOARDING_PRESET_DONE)).toBeNull();
      expect(localStorage.getItem(LS.ONBOARDING_HINTS_DONE)).toBeNull();
    });

    it('does not open duplicate dialogs while sync setup is already active', async () => {
      const firstSetup = component.setupSync();
      const secondSetup = component.setupSync();

      await Promise.all([firstSetup, secondSetup]);

      expect(mockDialog.open).toHaveBeenCalledTimes(1);

      afterClosed$.next();
      await component.setupSync();

      expect(mockDialog.open).toHaveBeenCalledTimes(2);
    });

    it('does not open a stale dialog if a preset is selected while sync setup is loading', async () => {
      const setupPromise = component.setupSync();
      component.selectedPreset.set(ONBOARDING_PRESETS[0]);

      await setupPromise;

      expect(mockDialog.open).not.toHaveBeenCalled();
      expect(component.isSyncSetupInProgress()).toBeFalse();
    });
  });
});
