import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DialogFlowtimeSettingsComponent } from './dialog-flowtime-settings.component';
import { GlobalConfigService } from '../../config/global-config.service';
import { MatDialogRef } from '@angular/material/dialog';
import { ReactiveFormsModule } from '@angular/forms';
import { FormlyModule } from '@ngx-formly/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import { RepeatSectionTypeComponent } from '../../config/repeat-section-type/repeat-section-type.component';

describe('DialogFlowtimeSettingsComponent', () => {
  let component: DialogFlowtimeSettingsComponent;
  let fixture: ComponentFixture<DialogFlowtimeSettingsComponent>;
  let globalConfigServiceMock: any;
  let matDialogRefMock: any;

  beforeEach(async () => {
    globalConfigServiceMock = {
      cfg: jasmine.createSpy('cfg').and.returnValue({
        flowtime: {
          isBreakEnabled: true,
          breakMode: 'rule',
          breakRules: [{ minDuration: 0, maxDuration: 1500000, breakDuration: 300000 }],
        },
      }),
      updateSection: jasmine.createSpy('updateSection'),
    };

    matDialogRefMock = {
      close: jasmine.createSpy('close'),
    };

    await TestBed.configureTestingModule({
      imports: [
        DialogFlowtimeSettingsComponent,
        ReactiveFormsModule,
        FormlyModule.forRoot({
          types: [{ name: 'repeat', component: RepeatSectionTypeComponent }],
        }),
        FormlyMaterialModule,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: GlobalConfigService, useValue: globalConfigServiceMock },
        { provide: MatDialogRef, useValue: matDialogRefMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogFlowtimeSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize with values from GlobalConfigService and convert ms to minutes', () => {
    const model = component.model();
    expect(model.isBreakEnabled).toBe(true);
    expect(model.breakRules?.length).toBe(1);
    expect(model.breakRules![0].maxDuration).toBe(25); // 1500000 / 60000
    expect(model.breakRules![0].breakDuration).toBe(5); // 300000 / 60000
  });

  describe('save()', () => {
    it('should convert minutes back to ms and save the config', () => {
      component.save();
      expect(globalConfigServiceMock.updateSection).toHaveBeenCalledWith(
        'flowtime',
        jasmine.objectContaining({
          breakRules: [{ minDuration: 0, maxDuration: 1500000, breakDuration: 300000 }],
        }),
        true,
      );
      expect(matDialogRefMock.close).toHaveBeenCalled();
    });

    it('should sort rules by minDuration', () => {
      component.model.set({
        ...component.model(),
        breakRules: [
          { minDuration: 30, maxDuration: 60, breakDuration: 10 },
          { minDuration: 0, maxDuration: 30, breakDuration: 5 },
        ],
      });

      component.save();
      const savedConfig =
        globalConfigServiceMock.updateSection.calls.mostRecent().args[1];
      expect(savedConfig.breakRules[0].minDuration).toBe(0);
      expect(savedConfig.breakRules[1].minDuration).toBe(30 * 60000);
    });

    it('should clamp maxDuration to minDuration if invalid', () => {
      component.model.set({
        ...component.model(),
        breakRules: [{ minDuration: 30, maxDuration: 20, breakDuration: 5 }],
      });

      component.save();
      const savedConfig =
        globalConfigServiceMock.updateSection.calls.mostRecent().args[1];
      expect(savedConfig.breakRules[0].maxDuration).toBe(30 * 60000);
    });

    it('should save empty maxDuration as null for open-ended rules', () => {
      component.model.set({
        ...component.model(),
        breakRules: [{ minDuration: 90, maxDuration: null, breakDuration: 15 }],
      });

      component.save();
      const savedConfig =
        globalConfigServiceMock.updateSection.calls.mostRecent().args[1];
      expect(savedConfig.breakRules[0]).toEqual({
        minDuration: 90 * 60000,
        maxDuration: null,
        breakDuration: 15 * 60000,
      });
    });
  });

  // Footgun guard: the preservation only works while every level of the
  // breakRules `repeat` opts out of Formly's hide-reset. A future field added
  // without `resetOnHide: false` would silently re-introduce the #7581 wipe.
  // This assertion is deterministic (no async hide settling) and fails fast.
  describe('field config opts out of hide-reset at every level', () => {
    it('sets resetOnHide:false on every hideable break field', () => {
      const fields = component.fields() as any[];
      const byKey = (key: string): any => fields.find((f) => f.key === key);

      expect(byKey('breakPercentage').resetOnHide)
        .withContext('breakPercentage')
        .toBe(false);

      const breakRules = byKey('breakRules');
      expect(breakRules.resetOnHide).withContext('breakRules field').toBe(false);
      expect(breakRules.fieldArray.resetOnHide)
        .withContext('breakRules.fieldArray')
        .toBe(false);
      breakRules.fieldArray.fieldGroup.forEach((inner: any) => {
        expect(inner.resetOnHide)
          .withContext(`breakRules row field "${inner.key}"`)
          .toBe(false);
      });
    });
  });

  // Regression: switching break mode hides the rule/percentage section. Without
  // `resetOnHide: false` on every level of the `repeat` (field, fieldArray and
  // each inner input), Formly strips the hidden rule rows' values, wiping the
  // user's break rules on a Rule -> Ratio -> Rule round-trip (issue #7581).
  // These drive the real `breakMode` control rather than calling internal model
  // setters, so they fail the way the bug actually reproduces in the dialog.
  describe('break-mode switch preserves hidden values', () => {
    const switchMode = (mode: 'ratio' | 'rule'): void => {
      (component.form.get('breakMode') as any).setValue(mode);
      fixture.detectChanges();
    };
    const rulesCtrl = (): any => component.form.get('breakRules');

    it('preserves a single rule across Rule -> Ratio -> Rule', () => {
      const expected = JSON.stringify(component.model().breakRules);
      switchMode('ratio');
      switchMode('rule');
      expect(JSON.stringify(component.model().breakRules))
        .withContext('model')
        .toEqual(expected);
      expect(JSON.stringify(rulesCtrl().value)).withContext('form').toEqual(expected);
    });

    it('preserves two rules across the round-trip', () => {
      component.model.set({
        ...component.model(),
        breakRules: [
          { minDuration: 0, maxDuration: 25, breakDuration: 5 },
          { minDuration: 25, maxDuration: 60, breakDuration: 10 },
        ],
      });
      fixture.detectChanges();
      const expected = JSON.stringify(component.model().breakRules);
      switchMode('ratio');
      switchMode('rule');
      expect(JSON.stringify(component.model().breakRules))
        .withContext('model with two rules')
        .toEqual(expected);
    });

    it('preserves an edited rule value across the round-trip', () => {
      rulesCtrl().at(0).get('maxDuration').setValue(40);
      rulesCtrl().at(0).get('breakDuration').setValue(12);
      fixture.detectChanges();
      switchMode('ratio');
      switchMode('rule');
      expect(rulesCtrl().at(0).value)
        .withContext('edited values survive')
        .toEqual({ minDuration: 0, maxDuration: 40, breakDuration: 12 });
    });

    it('lets the user clear a field right after the switch (no snap-back)', () => {
      switchMode('ratio');
      switchMode('rule');
      rulesCtrl().at(0).get('minDuration').setValue(null);
      fixture.detectChanges();
      expect(rulesCtrl().at(0).get('minDuration').value)
        .withContext('cleared field stays cleared')
        .toBe(null);
    });

    it('save() after the round-trip persists the original rule in ms', () => {
      switchMode('ratio');
      switchMode('rule');
      component.save();
      const saved = globalConfigServiceMock.updateSection.calls.mostRecent().args[1];
      expect(saved.breakRules).toEqual([
        { minDuration: 0, maxDuration: 1500000, breakDuration: 300000 },
      ]);
    });

    it('keeps the form valid in rule mode (hidden required percentage does not block)', () => {
      switchMode('ratio');
      switchMode('rule');
      expect(component.form.valid).withContext('form.valid in rule mode').toBe(true);
    });
  });

  describe('validator', () => {
    it('should mark rule row invalid if maxDuration < minDuration', () => {
      const breakRules = component.form.get('breakRules') as any;
      const firstRow = breakRules.at(0);

      firstRow.get('minDuration').setValue(20);
      firstRow.get('maxDuration').setValue(10);
      firstRow.updateValueAndValidity();
      fixture.detectChanges();

      expect(firstRow.valid).toBe(false);
      expect(firstRow.hasError('minMaxDuration')).toBe(true);
    });

    it('should revalidate when only minDuration changes', () => {
      const breakRules = component.form.get('breakRules') as any;
      const firstRow = breakRules.at(0);

      firstRow.get('minDuration').setValue(0);
      firstRow.get('maxDuration').setValue(25);
      firstRow.updateValueAndValidity();
      expect(firstRow.valid).toBe(true);

      firstRow.get('minDuration').setValue(30);
      firstRow.updateValueAndValidity();
      fixture.detectChanges();

      expect(firstRow.valid).toBe(false);
      expect(firstRow.hasError('minMaxDuration')).toBe(true);
    });

    it('should allow null maxDuration for open-ended rules', () => {
      const breakRules = component.form.get('breakRules') as any;
      const firstRow = breakRules.at(0);

      firstRow.get('minDuration').setValue(90);
      firstRow.get('maxDuration').setValue(null);
      firstRow.updateValueAndValidity();
      fixture.detectChanges();

      expect(firstRow.valid).toBe(true);
    });
  });
});
