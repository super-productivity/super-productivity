import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideMockStore } from '@ngrx/store/testing';
import { TranslateModule } from '@ngx-translate/core';
import { IssueProviderSetupOverviewComponent } from './issue-provider-setup-overview.component';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { IssueProviderPluginDefinition } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { PluginService } from '../../../plugins/plugin.service';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';

type DisabledPlugin = ReturnType<
  PluginService['getDisabledIssueProviderPlugins']
>[number];

const definition: IssueProviderPluginDefinition = {
  configFields: [],
  getHeaders: () => ({}),
  searchIssues: () => Promise.resolve([]),
  getById: () => Promise.resolve({ id: '1', title: 'mock', body: '', url: '' }),
  getIssueLink: () => 'http://mock',
  issueDisplay: [],
};

describe('IssueProviderSetupOverviewComponent', () => {
  let fixture: ComponentFixture<IssueProviderSetupOverviewComponent>;
  let registry: PluginIssueProviderRegistryService;
  let disabledPlugins: ReturnType<typeof signal<DisabledPlugin[]>>;

  const tileLabels = (): string[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.provider-tile span'),
    ).map((el) => el.textContent?.trim() ?? '');

  beforeEach(() => {
    disabledPlugins = signal<DisabledPlugin[]>([]);
    TestBed.configureTestingModule({
      imports: [IssueProviderSetupOverviewComponent, TranslateModule.forRoot()],
      providers: [
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [] }],
        }),
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: PluginService,
          useValue: {
            getDisabledIssueProviderPlugins: () => disabledPlugins(),
            enableAndActivatePlugin: () => Promise.resolve(null),
          },
        },
      ],
    });
    registry = TestBed.inject(PluginIssueProviderRegistryService);
    fixture = TestBed.createComponent(IssueProviderSetupOverviewComponent);
    fixture.detectChanges();
  });

  it('shows a calendar plugin provider that registers after the panel was created', () => {
    expect(tileLabels()).not.toContain('CalDAV Events');

    registry.register({
      pluginId: 'caldav-calendar-provider',
      definition,
      name: 'CalDAV Events',
      humanReadableName: 'CalDAV Events',
      icon: 'extension',
      pollIntervalMs: 60000,
      issueStrings: { singular: 'Event', plural: 'Events' },
      useAgendaView: true,
    });
    fixture.detectChanges();

    expect(tileLabels()).toContain('CalDAV Events');
  });

  it('shows a disabled plugin provider discovered after the panel was created', () => {
    expect(tileLabels()).not.toContain('Late Plugin');

    disabledPlugins.set([
      {
        pluginId: 'late-plugin',
        name: 'Late Plugin',
        icon: 'extension',
        issueProviderKey: 'plugin:late-plugin',
        useAgendaView: false,
      },
    ]);
    fixture.detectChanges();

    expect(tileLabels()).toContain('Late Plugin');
  });
});
