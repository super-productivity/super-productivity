import {
  ComponentFixture,
  fakeAsync,
  flushMicrotasks,
  TestBed,
} from '@angular/core/testing';
import { EMPTY, of } from 'rxjs';
import { ConfigSectionComponent } from './config-section.component';
import { ConfigFormSection, ConfigSectionAction } from '../global-config.model';
import { WorkContextService } from '../../work-context/work-context.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExactAlarmStatusService } from '../../reminder/exact-alarm-status.service';
import { ReminderOverlayPermissionStatusService } from '../../reminder/reminder-overlay-permission-status.service';
import { Log } from '../../../core/log';
import { Component } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';

describe('ConfigSectionComponent onAction', () => {
  let component: ConfigSectionComponent;
  let fixture: ComponentFixture<ConfigSectionComponent>;

  const makeAction = (onClick: ConfigSectionAction['onClick']): ConfigSectionAction => ({
    label: 'TEST.ACTION',
    onClick,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigSectionComponent],
      providers: [
        { provide: WorkContextService, useValue: { onWorkContextChange$: EMPTY } },
        {
          provide: TranslateService,
          useValue: { onLangChange: EMPTY, instant: (key: string) => key },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigSectionComponent);
    component = fixture.componentInstance;
    // NOTE: intentionally no detectChanges() — exercise the class logic in
    // isolation without rendering the heavy template / child components.
  });

  afterEach(() => fixture?.destroy());

  it('splits row actions from button actions', () => {
    const button = makeAction(() => undefined);
    const row: ConfigSectionAction = { ...makeAction(() => undefined), isRow: true };
    component.section = {
      title: '',
      key: 'appFeatures',
      actions: [button, row],
    } as ConfigFormSection<Record<string, unknown>>;

    expect(component.rowActions()).toEqual([row]);
    expect(component.buttonActions()).toEqual([button]);
  });

  it('does not enter pending state for a synchronous (void) action', () => {
    const onClick = jasmine.createSpy('onClick');
    const action = makeAction(onClick);

    component.onAction(action);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(component.isActionPending(action)).toBe(false);
  });

  it('is pending while an async action runs and clears it on resolve', fakeAsync(() => {
    let resolve!: () => void;
    const onClick = jasmine
      .createSpy('onClick')
      .and.returnValue(new Promise<void>((res) => (resolve = res)));
    const action = makeAction(onClick);

    component.onAction(action);
    expect(component.isActionPending(action)).toBe(true);

    resolve();
    flushMicrotasks();
    expect(component.isActionPending(action)).toBe(false);
  }));

  it('ignores re-entry while the same action is pending (no double-fire)', fakeAsync(() => {
    let resolve!: () => void;
    const onClick = jasmine
      .createSpy('onClick')
      .and.returnValue(new Promise<void>((res) => (resolve = res)));
    const action = makeAction(onClick);

    component.onAction(action);
    component.onAction(action);

    expect(onClick).toHaveBeenCalledTimes(1);

    resolve();
    flushMicrotasks();
  }));

  it('clears pending state and logs when the async action rejects', fakeAsync(() => {
    const logSpy = spyOn(Log, 'err');
    let reject!: (err: unknown) => void;
    const action = makeAction(() => new Promise<void>((_res, rej) => (reject = rej)));

    component.onAction(action);
    expect(component.isActionPending(action)).toBe(true);

    reject(new Error('boom'));
    flushMicrotasks();

    expect(component.isActionPending(action)).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  }));

  it('catches a synchronous throw without leaving pending state', () => {
    const logSpy = spyOn(Log, 'err');
    const action = makeAction(() => {
      throw new Error('sync boom');
    });

    expect(() => component.onAction(action)).not.toThrow();
    expect(component.isActionPending(action)).toBe(false);
    expect(logSpy).toHaveBeenCalled();
  });
});

@Component({
  template: `
    <config-section
      [isExpanded]="true"
      (isExpandedChange)="changes.push($event)"
      [section]="section"
      [cfg]="cfg"
    ></config-section>
  `,
  imports: [ConfigSectionComponent],
})
class ConfigSectionHostComponent {
  section = { title: '', key: 'localization' } as ConfigFormSection<
    Record<string, unknown>
  >;
  cfg?: Record<string, unknown>;
  changes: boolean[] = [];
}

describe('ConfigSectionComponent isExpandedChange', () => {
  let fixture: ComponentFixture<ConfigSectionHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigSectionHostComponent, NoopAnimationsModule],
      providers: [
        { provide: WorkContextService, useValue: { onWorkContextChange$: EMPTY } },
        {
          provide: TranslateService,
          useValue: { onLangChange: EMPTY, instant: (key: string) => key },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfigSectionHostComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('emits when the section is collapsed by hand', () => {
    fixture.nativeElement.querySelector('.collapsible-header').click();

    expect(fixture.componentInstance.changes).toEqual([false]);
  });
});

// Users who look for why reminders arrive late go to the reminder settings,
// not the schedule dialog, so the inexact-alarm hint must show there too (#10424).
describe('ConfigSectionComponent exact-alarm hint', () => {
  let fixture: ComponentFixture<ConfigSectionHostComponent>;

  const render = (key: string, cfg?: Record<string, unknown>): HTMLElement => {
    fixture = TestBed.createComponent(ConfigSectionHostComponent);
    fixture.componentInstance.section = { title: '', key } as ConfigFormSection<
      Record<string, unknown>
    >;
    fixture.componentInstance.cfg = cfg;
    fixture.detectChanges();
    return fixture.nativeElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ConfigSectionHostComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: WorkContextService, useValue: { onWorkContextChange$: EMPTY } },
        { provide: ExactAlarmStatusService, useValue: { isDenied$: of(true) } },
        {
          provide: ReminderOverlayPermissionStatusService,
          useValue: { isDenied$: of(true) },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  it('shows the hint in the reminder section when exact alarms are denied', () => {
    expect(render('reminder').querySelector('exact-alarm-hint .callout')).not.toBeNull();
  });

  it('shows the overlay permission hint in the reminder section', () => {
    expect(
      render('reminder').querySelector('reminder-overlay-hint .callout'),
    ).not.toBeNull();
  });

  it('hides the hint while all reminders are disabled', () => {
    const element = render('reminder', { disableReminders: true });
    expect(element.querySelector('exact-alarm-hint')).toBeNull();
    expect(element.querySelector('reminder-overlay-hint')).toBeNull();
  });

  it('does not show the hint in other sections', () => {
    expect(render('localization').querySelector('exact-alarm-hint')).toBeNull();
  });
});
