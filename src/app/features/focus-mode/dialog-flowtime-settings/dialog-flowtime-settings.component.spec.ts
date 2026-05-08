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
