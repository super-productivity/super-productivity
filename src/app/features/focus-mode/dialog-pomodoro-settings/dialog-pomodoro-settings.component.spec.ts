import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { GlobalConfigService } from '../../config/global-config.service';
import { DialogPomodoroSettingsComponent } from './dialog-pomodoro-settings.component';
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';

describe('DialogPomodoroSettingsComponent', () => {
  let component: DialogPomodoroSettingsComponent;
  let mockDialogRef: jasmine.SpyObj<MatDialogRef<DialogPomodoroSettingsComponent>>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let environmentInjector: EnvironmentInjector;

  const defaultPomodoroConfig = {
    duration: 25 * 60 * 1000,
    breakDuration: 5 * 60 * 1000,
    longerBreakDuration: 15 * 60 * 1000,
    cyclesBeforeLongerBreak: 4,
  };

  beforeEach(() => {
    mockDialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [
      'cfg',
      'updateSection',
    ]);
    mockGlobalConfigService.cfg.and.returnValue({
      pomodoro: { ...defaultPomodoroConfig },
    } as any);

    TestBed.configureTestingModule({
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
      ],
    });

    environmentInjector = TestBed.inject(EnvironmentInjector);

    // Create component inside injection context
    runInInjectionContext(environmentInjector, () => {
      component = new DialogPomodoroSettingsComponent();
    });
  });

  describe('initialization', () => {
    it('should initialize model with current pomodoro config', () => {
      expect(component.model.duration).toBe(defaultPomodoroConfig.duration);
      expect(component.model.breakDuration).toBe(defaultPomodoroConfig.breakDuration);
      expect(component.model.longerBreakDuration).toBe(
        defaultPomodoroConfig.longerBreakDuration,
      );
      expect(component.model.cyclesBeforeLongerBreak).toBe(
        defaultPomodoroConfig.cyclesBeforeLongerBreak,
      );
    });

    it('should have a form group', () => {
      expect(component.form).toBeTruthy();
    });

    it('should have 4 form fields configured', () => {
      expect(component.fields.length).toBe(4);
    });

    it('should have duration field', () => {
      const durationField = component.fields.find((f) => f.key === 'duration');
      expect(durationField).toBeTruthy();
      expect(durationField?.type).toBe('duration');
    });

    it('should have breakDuration field', () => {
      const breakField = component.fields.find((f) => f.key === 'breakDuration');
      expect(breakField).toBeTruthy();
      expect(breakField?.type).toBe('duration');
    });

    it('should have longerBreakDuration field', () => {
      const longBreakField = component.fields.find(
        (f) => f.key === 'longerBreakDuration',
      );
      expect(longBreakField).toBeTruthy();
      expect(longBreakField?.type).toBe('duration');
    });

    it('should have cyclesBeforeLongerBreak field', () => {
      const cyclesField = component.fields.find(
        (f) => f.key === 'cyclesBeforeLongerBreak',
      );
      expect(cyclesField).toBeTruthy();
      expect(cyclesField?.type).toBe('input');
    });
  });

  describe('save', () => {
    it('should update global config section with model values', () => {
      component.save();

      expect(mockGlobalConfigService.updateSection).toHaveBeenCalledWith(
        'pomodoro',
        component.model,
        true,
      );
    });

    it('should close dialog with model after saving', () => {
      component.save();

      expect(mockDialogRef.close).toHaveBeenCalledWith(component.model);
    });

    it('should mark form as touched when invalid', () => {
      spyOn(component.form, 'markAllAsTouched');
      Object.defineProperty(component.form, 'invalid', { value: true });

      component.save();

      expect(component.form.markAllAsTouched).toHaveBeenCalled();
      expect(mockGlobalConfigService.updateSection).not.toHaveBeenCalled();
      expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close dialog without saving', () => {
      component.close();

      expect(mockDialogRef.close).toHaveBeenCalledWith();
      expect(mockGlobalConfigService.updateSection).not.toHaveBeenCalled();
    });
  });

  describe('model updates', () => {
    it('should allow updating duration', () => {
      const newDuration = 30 * 60 * 1000;
      component.model = { ...component.model, duration: newDuration };

      expect(component.model.duration).toBe(newDuration);
    });

    it('should allow updating breakDuration', () => {
      const newBreakDuration = 10 * 60 * 1000;
      component.model = { ...component.model, breakDuration: newBreakDuration };

      expect(component.model.breakDuration).toBe(newBreakDuration);
    });

    it('should allow updating longerBreakDuration', () => {
      const newLongerBreakDuration = 20 * 60 * 1000;
      component.model = {
        ...component.model,
        longerBreakDuration: newLongerBreakDuration,
      };

      expect(component.model.longerBreakDuration).toBe(newLongerBreakDuration);
    });

    it('should allow updating cyclesBeforeLongerBreak', () => {
      component.model = { ...component.model, cyclesBeforeLongerBreak: 6 };

      expect(component.model.cyclesBeforeLongerBreak).toBe(6);
    });
  });
});
