import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { SYNC_FORM } from './sync-form.const';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { FormlyBtnComponent } from '../../../ui/formly-button/formly-btn.component';
import { Log } from '../../../core/log';

@Component({
  selector: 'saf-pick-host',
  standalone: true,
  imports: [ReactiveFormsModule, FormlyModule],
  template: `<form [formGroup]="form">
    <formly-form
      [form]="form"
      [fields]="fields"
      [model]="model"
    ></formly-form>
  </form>`,
})
class SafPickHostComponent {
  form = new UntypedFormGroup({});
  // Root model carries the selected provider so the field's REAL
  // 'props.required' expression (isSyncProvider at depth 2) evaluates live.
  model: Record<string, unknown> = { syncProvider: SyncProviderId.LocalFile };
  fields: FormlyFieldConfig[] = [];
}

/**
 * #9075 made the Android SAF pick prepare-only: `setupSaf()` no longer
 * persists, so the ONLY route from picker to credential store is
 * `form.value.localFileSync.safFolderUri` → settings Save →
 * `setProviderConfig`. These tests mount the REAL field config from
 * SYNC_FORM with the REAL `btn` Formly type (only the platform gate and the
 * provider-loading onClick are stubbed) and pin that route end to end —
 * the dialog spec stubs its template, so nothing else executes it.
 */
describe('SYNC_FORM Android SAF pick → form value (#9075)', () => {
  const PICKED_URI = 'content://com.android.externalstorage.documents/tree/primary';

  const findAndroidSafField = (): FormlyFieldConfig => {
    const field = (SYNC_FORM.items as FormlyFieldConfig[])
      .filter((f) => f.key === 'localFileSync')
      .flatMap((f) => f.fieldGroup ?? [])
      .find((f) => f.key === 'safFolderUri');
    if (!field) {
      throw new Error('Android SAF picker field not found in SYNC_FORM');
    }
    return field;
  };

  let fixture: ComponentFixture<SafPickHostComponent>;
  let host: SafPickHostComponent;
  let onClickSpy: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SafPickHostComponent,
        FormlyBtnComponent,
        // Same registration shape as formly-config.module.ts.
        FormlyModule.forRoot({
          types: [{ name: 'btn', component: FormlyBtnComponent, wrappers: [] }],
        }),
        TranslateModule.forRoot(),
      ],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    const realField = findAndroidSafField();
    onClickSpy = jasmine.createSpy('setupSaf onClick').and.resolveTo(PICKED_URI);

    fixture = TestBed.createComponent(SafPickHostComponent);
    host = fixture.componentInstance;
    // The real group wrapper is platform-gated (hidden off-Android), so
    // rebuild it with the same key; the field keeps its real key, type,
    // and expressions — only onClick (which loads providers and opens the
    // native SAF picker) is stubbed.
    host.fields = [
      {
        key: 'localFileSync',
        fieldGroup: [
          {
            ...realField,
            templateOptions: { ...realField.templateOptions, onClick: onClickSpy },
          },
        ],
      },
    ];
    fixture.detectChanges();
  });

  const clickPickButton = async (): Promise<void> => {
    fixture.debugElement.query(By.css('button')).nativeElement.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('keeps the picker at localFileSync.safFolderUri as a btn field (the path Save persists)', () => {
    const field = findAndroidSafField();
    expect(field.type).toBe('btn');
    // updateSettingsFromForm reads settings.localFileSync (PROP_MAP_TO_FORM)
    // and persists it via setProviderConfig — renaming either key silently
    // severs the only persistence route left after #9075.
    expect(field.key).toBe('safFolderUri');
  });

  it('writes the picked URI into form.value at the path Save reads, and dirties the form', async () => {
    await clickPickButton();

    expect(onClickSpy).toHaveBeenCalledTimes(1);
    expect(
      (host.form.value as { localFileSync?: { safFolderUri?: string } }).localFileSync
        ?.safFolderUri,
    ).toBe(PICKED_URI);
    expect(host.form.dirty).toBe(true);
  });

  it('blocks Save (required → invalid) until a folder is picked, then validates', async () => {
    expect(host.form.invalid)
      .withContext('no folder picked yet — the real required expression must gate Save')
      .toBe(true);

    await clickPickButton();

    expect(host.form.valid).toBe(true);
  });

  it('leaves the form untouched when the picker is cancelled (setupSaf rejects)', async () => {
    const logErrSpy = spyOn(Log, 'err');
    onClickSpy.and.rejectWith(new Error('User cancelled folder selection'));

    await clickPickButton();

    expect(
      (host.form.value as { localFileSync?: { safFolderUri?: string } }).localFileSync
        ?.safFolderUri,
    ).toBeFalsy();
    expect(host.form.invalid).toBe(true);
    expect(logErrSpy).toHaveBeenCalled();
  });
});

describe('SYNC_FORM encryption action visibility (#9268)', () => {
  type EncryptionVisibilityModel = {
    syncProvider: SyncProviderId;
    isEncryptionEnabled: boolean;
    _isInitialSetup: boolean;
    _activeProviderId: SyncProviderId | null;
  };

  const findFieldPath = (
    fields: FormlyFieldConfig[],
    className: string,
  ): FormlyFieldConfig[] | undefined => {
    for (const field of fields) {
      if (field.className === className) {
        return [field];
      }
      const childPath = field.fieldGroup
        ? findFieldPath(field.fieldGroup, className)
        : undefined;
      if (childPath) {
        return [field, ...childPath];
      }
    }
    return undefined;
  };

  const isFieldHidden = (
    className: string,
    model: EncryptionVisibilityModel,
  ): boolean => {
    const path = findFieldPath(SYNC_FORM.items as FormlyFieldConfig[], className);
    if (!path) {
      throw new Error(`${className} not found in SYNC_FORM`);
    }

    let field: FormlyFieldConfig = { model };
    for (const fieldConfig of path) {
      field = { ...fieldConfig, model, parent: field };
    }
    if (typeof field.hideExpression !== 'function') {
      throw new Error(`${className} has no hide expression`);
    }

    return field.hideExpression(model, {}, field);
  };

  it('hides the action during initial file-based sync setup', () => {
    expect(
      isFieldHidden('e2e-file-based-enable-encryption-btn', {
        syncProvider: SyncProviderId.Dropbox,
        isEncryptionEnabled: false,
        _isInitialSetup: true,
        _activeProviderId: null,
      }),
    ).toBeTrue();
  });

  it('shows the action for an established unencrypted file-based provider', () => {
    expect(
      isFieldHidden('e2e-file-based-enable-encryption-btn', {
        syncProvider: SyncProviderId.Dropbox,
        isEncryptionEnabled: false,
        _isInitialSetup: false,
        _activeProviderId: SyncProviderId.Dropbox,
      }),
    ).toBeFalse();
  });

  it('hides active-provider encryption actions during an unsaved switch', () => {
    const switchedFileProvider: EncryptionVisibilityModel = {
      syncProvider: SyncProviderId.Dropbox,
      isEncryptionEnabled: false,
      _isInitialSetup: false,
      _activeProviderId: SyncProviderId.WebDAV,
    };
    expect(
      isFieldHidden('e2e-file-based-enable-encryption-btn', switchedFileProvider),
    ).toBeTrue();
    expect(
      isFieldHidden('e2e-enable-encryption-btn', {
        syncProvider: SyncProviderId.SuperSync,
        isEncryptionEnabled: false,
        _isInitialSetup: false,
        _activeProviderId: SyncProviderId.WebDAV,
      }),
    ).toBeTrue();
    expect(
      isFieldHidden('encryption-status-box', {
        ...switchedFileProvider,
        isEncryptionEnabled: true,
      }),
    ).toBeTrue();
  });
});
