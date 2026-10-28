import { signal, WritableSignal } from '@angular/core';
import { SuperSyncCaptureUnsupportedError } from '@sp/sync-providers/super-sync';
import { T } from '../../../../t.const';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { FormlyModule } from '@ngx-formly/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { SuperSyncCaptureGrantInfo } from '@sp/sync-providers/super-sync';
import { of } from 'rxjs';
import { DateTimeFormatService } from '../../../../core/date-time-format/date-time-format.service';
import { ShareService } from '../../../../core/share/share.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { AgentCaptureService } from '../agent-capture.service';
import { AgentCaptureSettingsComponent } from './agent-capture-settings.component';

describe('AgentCaptureSettingsComponent', () => {
  const GRANT: SuperSyncCaptureGrantInfo = {
    id: 'g1',
    clientName: 'Claude Code',
    createdAt: 1,
    lastUsedAt: null,
    // Local midday: the same calendar day in every test timezone.
    expiresAt: new Date(2027, 9, 11, 12).getTime(),
    pendingCount: 2,
  };
  let fixture: ComponentFixture<AgentCaptureSettingsComponent>;
  let component: AgentCaptureSettingsComponent;
  let capture: jasmine.SpyObj<AgentCaptureService> & {
    isEnabled: ReturnType<typeof signal<boolean>>;
  };
  let isConfirmed: boolean;
  let snack: jasmine.SpyObj<SnackService>;

  const setup = (isAvailable = true): void => {
    capture.isSuperSyncActive.and.returnValue(isAvailable);
    fixture = TestBed.createComponent(AgentCaptureSettingsComponent);
    component = fixture.componentInstance;
    // Keyless block: no form control, only the field object.
    component.field = { props: {}, templateOptions: {} } as never;
  };
  const render = async (): Promise<void> => {
    fixture.detectChanges();
    // Lets the load effect's chained loads settle; whenStable does not track them.
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const text = (): string => fixture.nativeElement.textContent;

  beforeEach(async () => {
    isConfirmed = true;
    capture = Object.assign(
      jasmine.createSpyObj<AgentCaptureService>('AgentCaptureService', [
        'isSuperSyncActive',
        'getMcpUrl',
        'listGrants',
        'countPending',
        'switchOn',
        'switchOff',
        'createToken',
        'createConnectCode',
        'revokeGrant',
      ]),
      { isEnabled: signal(true) },
    );
    capture.getMcpUrl.and.resolveTo('https://sync.example/mcp');
    capture.listGrants.and.resolveTo([GRANT]);
    capture.countPending.and.resolveTo(GRANT.pendingCount);
    snack = jasmine.createSpyObj<SnackService>('SnackService', ['open']);

    await TestBed.configureTestingModule({
      imports: [
        AgentCaptureSettingsComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: AgentCaptureService, useValue: capture },
        { provide: SnackService, useValue: snack },
        { provide: ShareService, useValue: {} },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-gb' } },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(isConfirmed) }) },
        },
      ],
    }).compileComponents();
  });

  it('starts collapsed and opening it never enables assistant access', async () => {
    capture.isEnabled.set(false);
    setup();
    await render();
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector(
      'details.agent-capture',
    );
    expect(details.open).toBeFalse();
    expect(details.querySelector('summary')!.textContent).toContain('CAPTURE_STATE_OFF');
    details.querySelector('summary')!.click();
    await render();
    expect(details.open).toBeTrue();
    expect(capture.switchOn).not.toHaveBeenCalled();
    expect(capture.createConnectCode).not.toHaveBeenCalled();
    expect(capture.createToken).not.toHaveBeenCalled();
    expect(capture.listGrants).not.toHaveBeenCalled();
  });

  it('keeps the enabled state visible while connection controls stay collapsed', async () => {
    setup();
    await render();
    const details: HTMLDetailsElement = fixture.nativeElement.querySelector(
      'details.agent-capture',
    );
    expect(details.open).toBeFalse();
    expect(details.querySelector('summary')!.textContent).toContain('CAPTURE_STATE_ON');
    expect(fixture.nativeElement.querySelector('details.manual-tokens').open).toBeFalse();
  });

  it('shows a one-time connection code and clears it when capture is disabled', async () => {
    capture.createConnectCode.and.resolveTo({
      code: 'ABCDE-FGHJK',
      expiresAt: Date.now() + 600000,
    });
    setup();
    await render();
    await component.createConnectCode();
    await render();
    expect(fixture.nativeElement.querySelector('[e2e="captureConnectCode"]').value).toBe(
      'ABCDE-FGHJK',
    );
    expect(text()).toContain('CAPTURE_CONNECT_CODE_WARNING');
    await component.turnOff();
    expect(component.connectCode()).toBeNull();
  });

  it('says what access means and shows the privacy note only before enabling', async () => {
    (capture.isEnabled as WritableSignal<boolean>).set(false);
    setup();
    await render();
    const summary = fixture.nativeElement.querySelector(
      'details.agent-capture > summary',
    );
    // Collapsed header stays short: title, Optional badge and state only.
    expect(summary.textContent).not.toContain('CAPTURE_INFO');
    expect(summary.textContent).toContain('CAPTURE_OPTIONAL');
    expect(text()).toContain('CAPTURE_INFO');
    expect(text()).toContain('CAPTURE_PRIVACY');

    (capture.isEnabled as WritableSignal<boolean>).set(true);
    await render();
    expect(text()).toContain('CAPTURE_INFO');
    expect(text()).not.toContain('CAPTURE_PRIVACY');
  });

  it('asks to save SuperSync first when it is not the active provider', async () => {
    setup(false);
    await render();
    expect(text()).toContain('CAPTURE_SAVE_FIRST');
    expect(capture.listGrants).not.toHaveBeenCalled();
  });

  it('lists the MCP URL and connected assistants when on', async () => {
    setup();
    await render();
    expect(fixture.nativeElement.querySelector('input.value').value).toBe(
      'https://sync.example/mcp',
    );
    expect(text()).toContain('Claude Code');
  });

  it('loads once capture is switched on from another device', async () => {
    (capture.isEnabled as WritableSignal<boolean>).set(false);
    setup();
    await render();
    expect(capture.getMcpUrl).not.toHaveBeenCalled();

    (capture.isEnabled as WritableSignal<boolean>).set(true);
    await render();
    expect(fixture.nativeElement.querySelector('input.value').value).toBe(
      'https://sync.example/mcp',
    );
  });

  it('shows when each token expires', async () => {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      F: {
        SYNC: { FORM: { SUPER_SYNC: { CAPTURE_GRANT_INFO: 'expires {{expires}}' } } },
      },
    });
    translate.use('en');
    setup();
    await render();
    expect(text()).toContain('expires 10/11/27');
  });

  it('shows a new token once and adds its assistant to the list', async () => {
    capture.createToken.and.resolveTo({
      token: 'sp_cap_secret',
      grant: { ...GRANT, id: 'g2', clientName: 'Cursor', pendingCount: 0 },
    });
    setup();
    await render();

    component.clientName.set('  Cursor ');
    await component.createToken();

    expect(capture.createToken).toHaveBeenCalledWith('Cursor');
    expect(component.newToken()).toBe('sp_cap_secret');
    expect(component.grants().map((g) => g.id)).toEqual(['g1', 'g2']);
    // Ready to paste: no environment variable the user has to set first.
    expect(component.setupCommand()).toBe(
      'claude mcp add --transport http super-productivity https://sync.example/mcp ' +
        '--header "Authorization: Bearer sp_cap_secret"',
    );
  });

  it('says so when the server does not support capture', async () => {
    capture.switchOn.and.rejectWith(new SuperSyncCaptureUnsupportedError());
    (capture.isEnabled as WritableSignal<boolean>).set(false);
    setup();
    await render();

    await component.turnOn();

    expect(snack.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.F.SYNC.FORM.SUPER_SYNC.CAPTURE_S_UNSUPPORTED,
    });
  });

  it('revokes with discard only after the confirm', async () => {
    capture.revokeGrant.and.resolveTo();
    setup();
    await render();

    isConfirmed = false;
    await component.revoke(GRANT, true);
    expect(capture.revokeGrant).not.toHaveBeenCalled();

    isConfirmed = true;
    await component.revoke(GRANT, true);
    expect(capture.revokeGrant).toHaveBeenCalledWith('g1', true);
    expect(component.grants()).toEqual([]);
  });

  it('turns off after the confirm and reports a failure without throwing', async () => {
    capture.switchOff.and.rejectWith(new Error('offline'));
    setup();
    await render();

    await component.turnOff();

    expect(capture.switchOff).toHaveBeenCalled();
    expect(snack.open).toHaveBeenCalled();
    expect(component.isBusy()).toBeFalse();
  });
});
