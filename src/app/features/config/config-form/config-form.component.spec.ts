import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormlyModule } from '@ngx-formly/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import { FormlyMatToggleModule } from '@ngx-formly/material/toggle';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { ConfigFormComponent } from './config-form.component';
import { FormlySlideToggleComponent } from '../../../ui/formly-slide-toggle/formly-slide-toggle.component';

describe('ConfigFormComponent', () => {
  let fixture: ComponentFixture<ConfigFormComponent>;
  let saved: Record<string, unknown>[];

  const getToggles = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button[role=switch]'));

  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ConfigFormComponent,
        FormlyModule.forRoot({
          extras: { immutable: true },
          types: [{ name: 'slide-toggle', component: FormlySlideToggleComponent }],
        }),
        FormlyMaterialModule,
        FormlyMatToggleModule,
        TranslateModule.forRoot(),
      ],
      providers: [provideNoopAnimations()],
    }).compileComponents();
    fixture = TestBed.createComponent(ConfigFormComponent);
    fixture.componentRef.setInput('cfg', { isA: false, isB: false });
    fixture.componentRef.setInput('formCfg', [
      { key: 'isA', type: 'checkbox', templateOptions: { label: 'A' } },
      { key: 'isB', type: 'checkbox', templateOptions: { label: 'B' } },
    ]);
    fixture.componentRef.setInput('sectionKey', 'misc');
    saved = [];
    fixture.componentInstance.save.subscribe(({ config }) =>
      saved.push(config as Record<string, unknown>),
    );
    await settle();
  });

  it('keeps the focused field when the saved section comes back from the store (#8447)', async () => {
    const toggle = getToggles()[0];
    toggle.focus();
    toggle.click();
    await settle();

    // the store hands the section back as a fresh but equal object
    fixture.componentRef.setInput('cfg', { ...saved[0] });
    await settle();

    expect(toggle.isConnected).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('keeps focus on a slide-toggle field when it is switched (#8447)', async () => {
    fixture.componentRef.setInput('formCfg', [
      { key: 'isA', type: 'slide-toggle', templateOptions: { label: 'A' } },
    ]);
    await settle();
    const toggle = getToggles()[0];
    toggle.focus();
    toggle.click();
    await settle();

    expect(document.activeElement).toBe(toggle);
    expect(saved[0]).toEqual({ isA: true, isB: false });
  });

  it('shows a section that changed elsewhere', async () => {
    getToggles()[0].click();
    await settle();
    fixture.componentRef.setInput('cfg', { ...saved[0] });
    await settle();

    fixture.componentRef.setInput('cfg', { isA: true, isB: true });
    await settle();

    expect(getToggles().map((t) => t.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
    ]);
  });
});
