import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormlyModule } from '@ngx-formly/core';
import { TranslateModule } from '@ngx-translate/core';
import { FormlyAssistantAccessSettingsComponent } from './formly-assistant-access-settings.component';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { AssistantAccessState } from '../../../../electron/shared-with-frontend/assistant-access.model';

describe('FormlyAssistantAccessSettingsComponent', () => {
  let fixture: ComponentFixture<FormlyAssistantAccessSettingsComponent>;
  let component: FormlyAssistantAccessSettingsComponent;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;

  const state = (
    overrides: Partial<AssistantAccessState> = {},
  ): AssistantAccessState => ({
    isEnabled: true,
    scopes: [],
    hasCredential: false,
    isListening: true,
    ...overrides,
  });

  const setEa = (api: Record<string, unknown>): void => {
    (window as unknown as { ea: unknown }).ea = {
      getAssistantAccessState: jasmine.createSpy().and.resolveTo(state()),
      ...api,
    };
  };

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    snackServiceSpy = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    await TestBed.configureTestingModule({
      imports: [
        FormlyAssistantAccessSettingsComponent,
        FormlyModule.forRoot(),
        TranslateModule.forRoot(),
      ],
      providers: [{ provide: SnackService, useValue: snackServiceSpy }],
    }).compileComponents();

    fixture = TestBed.createComponent(FormlyAssistantAccessSettingsComponent);
    component = fixture.componentInstance;
    component.field = { props: {}, templateOptions: {} } as never;
  });

  afterEach(() => {
    delete (window as unknown as { ea?: unknown }).ea;
  });

  it('hides everything but the switch while access is off', async () => {
    setEa({
      getAssistantAccessState: jasmine
        .createSpy()
        .and.resolveTo(state({ isEnabled: false, isListening: false })),
    });
    fixture.detectChanges();
    await settle();

    expect(component.isEnabled()).toBe(false);
    expect(fixture.nativeElement.querySelector('.scope')).toBeNull();
    expect(fixture.nativeElement.querySelector('.snippet')).toBeNull();
  });

  it('switches access on over IPC', async () => {
    const setAssistantAccessEnabled = jasmine
      .createSpy()
      .and.resolveTo(state({ isEnabled: true }));
    setEa({
      getAssistantAccessState: jasmine
        .createSpy()
        .and.resolveTo(state({ isEnabled: false })),
      setAssistantAccessEnabled,
    });
    fixture.detectChanges();
    await settle();

    await component.toggle(true);

    expect(setAssistantAccessEnabled).toHaveBeenCalledOnceWith(true);
    expect(component.isEnabled()).toBe(true);
  });

  it('revoking read access also revokes notes access', async () => {
    const setAssistantAccessScopes = jasmine
      .createSpy()
      .and.callFake(async (scopes) => state({ scopes }));
    setEa({
      getAssistantAccessState: jasmine
        .createSpy()
        .and.resolveTo(
          state({ scopes: ['tasks:read', 'tasks:read_notes', 'tasks:capture'] }),
        ),
      setAssistantAccessScopes,
    });
    fixture.detectChanges();
    await settle();

    await component.setScope('tasks:read', false);

    expect(setAssistantAccessScopes).toHaveBeenCalledOnceWith(['tasks:capture']);
  });

  it('shows a generated key once and puts it into the setup snippets', async () => {
    setEa({
      rotateAssistantAccessCredential: jasmine.createSpy().and.resolveTo({
        credential: 'sp_mcp_NEWKEY',
        state: state({ hasCredential: true }),
      }),
    });
    fixture.detectChanges();
    await settle();
    expect(component.claudeCodeSnippet()).toContain('<ACCESS_KEY>');

    await component.generateKey();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.key-value').value).toBe('sp_mcp_NEWKEY');
    expect(component.claudeCodeSnippet()).toContain(
      'http://127.0.0.1:3876/mcp --header "Authorization: Bearer sp_mcp_NEWKEY"',
    );
    expect(JSON.parse(component.jsonSnippet())).toEqual({
      mcpServers: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'super-productivity': {
          type: 'http',
          url: 'http://127.0.0.1:3876/mcp',
          headers: { Authorization: 'Bearer sp_mcp_NEWKEY' },
        },
      },
    });
  });

  it('reports a change that could not be saved', async () => {
    setEa({
      setAssistantAccessEnabled: jasmine.createSpy().and.rejectWith(new Error('EACCES')),
    });
    fixture.detectChanges();
    await settle();

    await component.toggle(false);

    expect(snackServiceSpy.open).toHaveBeenCalledWith({
      type: 'ERROR',
      msg: T.GCF.MISC.ASSISTANT_ACCESS_SAVE_ERROR,
    });
    expect(component.isBusy()).toBe(false);
  });

  it('does not throw when the Electron bridge is unavailable', async () => {
    fixture.detectChanges();
    await settle();
    await component.toggle(true);
    expect(component.state()).toBeNull();
  });
});
