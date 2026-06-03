import { TestBed } from '@angular/core/testing';
import {
  EnvironmentInjector,
  runInInjectionContext,
  signal,
  WritableSignal,
} from '@angular/core';
import { of } from 'rxjs';

import { OnboardingPresetSelectionComponent } from './onboarding-preset-selection.component';
import { ONBOARDING_PRESETS } from './onboarding-presets.const';
import { GlobalConfigService } from '../config/global-config.service';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { LS } from '../../core/persistence/storage-keys.const';

describe('OnboardingPresetSelectionComponent', () => {
  let component: OnboardingPresetSelectionComponent;
  let mockDialog: jasmine.SpyObj<MatDialog>;
  let cfgSignal: WritableSignal<{ sync: { isEnabled: boolean } }>;

  const setup = (): void => {
    cfgSignal = signal({ sync: { isEnabled: false } });

    mockDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockDialog.open.and.returnValue({
      afterClosed: () => of(undefined),
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
    setup();
  });

  afterEach(() => {
    localStorage.removeItem(LS.ONBOARDING_PRESET_DONE);
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
      cfgSignal.set({ sync: { isEnabled: true } });
      let dismissedCount = 0;
      component.dismissed.subscribe(() => dismissedCount++);

      await component.setupSync();

      expect(dismissedCount).toBe(1);
      expect(localStorage.getItem(LS.ONBOARDING_PRESET_DONE)).toBe('true');
    });

    it('keeps onboarding open when sync was not enabled (dialog cancelled)', async () => {
      cfgSignal.set({ sync: { isEnabled: false } });
      let dismissedCount = 0;
      component.dismissed.subscribe(() => dismissedCount++);

      await component.setupSync();

      expect(dismissedCount).toBe(0);
      expect(localStorage.getItem(LS.ONBOARDING_PRESET_DONE)).toBeNull();
    });
  });
});
