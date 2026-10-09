import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { IssueProviderSetupOverviewComponent } from './issue-provider-setup-overview.component';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { RegisteredPluginIssueProvider } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { PluginService } from '../../../plugins/plugin.service';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';

type DisabledPlugin = ReturnType<
  PluginService['getDisabledIssueProviderPlugins']
>[number];

describe('IssueProviderSetupOverviewComponent', () => {
  let fixture: ComponentFixture<IssueProviderSetupOverviewComponent>;
  let registered: RegisteredPluginIssueProvider[];
  let registrationVersion: ReturnType<typeof signal<number>>;
  let disabledPlugins: ReturnType<typeof signal<DisabledPlugin[]>>;

  const tileNames = (): string[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.provider-tile span'),
    ).map((el) => el.textContent?.trim() ?? '');

  beforeEach(() => {
    registered = [];
    registrationVersion = signal(0);
    disabledPlugins = signal<DisabledPlugin[]>([]);

    TestBed.configureTestingModule({
      imports: [
        IssueProviderSetupOverviewComponent,
        TranslateModule.forRoot(),
        MatIconTestingModule,
      ],
      providers: [
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [] }],
        }),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            registrationVersion: registrationVersion.asReadonly(),
            getAvailableProviders: () => registered,
          },
        },
        {
          provide: PluginService,
          useValue: {
            getDisabledIssueProviderPlugins: () => disabledPlugins(),
            enableAndActivatePlugin: jasmine.createSpy().and.resolveTo(null),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(IssueProviderSetupOverviewComponent);
    fixture.detectChanges();
  });

  // Plugins are discovered only after the initial sync, which can finish after the
  // panel was opened.
  it('should show plugin providers that register after the panel rendered', () => {
    expect(tileNames()).not.toContain('CalDAV Events');

    registered = [
      {
        pluginId: 'caldav-calendar-provider',
        registeredKey: 'plugin:caldav' as RegisteredPluginIssueProvider['registeredKey'],
        name: 'CalDAV Events',
        icon: 'extension',
        useAgendaView: true,
      } as RegisteredPluginIssueProvider,
    ];
    registrationVersion.update((v) => v + 1);
    fixture.detectChanges();

    expect(tileNames()).toContain('CalDAV Events');
  });

  it('should show disabled plugin providers discovered after the panel rendered', () => {
    expect(tileNames()).not.toContain('GitHub');

    disabledPlugins.set([
      {
        pluginId: 'github-issue-provider',
        name: 'GitHub',
        icon: 'extension',
        issueProviderKey: 'GITHUB',
        useAgendaView: false,
      },
    ]);
    fixture.detectChanges();

    expect(tileNames()).toContain('GitHub');
  });
});
