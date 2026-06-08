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

  it('should keep mode-specific settings when fields are hidden', () => {
    const fields = component.fields();

    expect(fields.find((field) => field.key === 'breakMode')?.resetOnHide).toBe(false);
    expect(fields.find((field) => field.key === 'breakPercentage')?.resetOnHide).toBe(
      false,
    );
    expect(fields.find((field) => field.key === 'breakRules')?.resetOnHide).toBe(false);
  });

  it('should keep rule fields while switching Rule-based -> Ratio-based -> Rule-based', () => {
    const initialRules = component.model().breakRules;

    component.updateModel({
      ...component.model(),
      breakMode: 'ratio',
      breakRules: [],
    });

    expect(component.model().breakRules).toEqual(initialRules);

    component.updateModel({
      ...component.model(),
      breakMode: 'rule',
      breakRules: [
        {
          minDuration: null as unknown as number,
          maxDuration: null,
          breakDuration: null as unknown as number,
        },
      ],
    });

    expect(component.model().breakRules).toEqual(initialRules);
  });

  it('should keep rule fields when Formly emits blank strings while restoring the rule section', () => {
    const initialRules = component.model().breakRules;

    component.updateModel({
      ...component.model(),
      breakMode: 'ratio',
      breakRules: [],
    });

    component.updateModel({
      ...component.model(),
      breakMode: 'rule',
      breakRules: [
        {
          minDuration: '' as unknown as number,
          maxDuration: '' as unknown as number,
          breakDuration: '' as unknown as number,
        },
      ],
    });

    expect(component.model().breakRules).toEqual(initialRules);
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

    it('should preserve hidden break settings when Flowtime breaks are disabled', () => {
      component.model.set({
        isBreakEnabled: false,
      });

      component.save();
      const savedConfig =
        globalConfigServiceMock.updateSection.calls.mostRecent().args[1];
      expect(savedConfig).toEqual({
        isBreakEnabled: false,
        breakMode: 'rule',
        breakPercentage: 20,
        breakRules: [{ minDuration: 0, maxDuration: 1500000, breakDuration: 300000 }],
      });
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
