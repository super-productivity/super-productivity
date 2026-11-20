import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { Store } from '@ngrx/store';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  TranslateLoader,
  TranslateModule,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { IssuePanelComponent } from './issue-panel.component';
import { WorkContextService } from '../work-context/work-context.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginService } from '../../plugins/plugin.service';
import { TaskService } from '../tasks/task.service';
import { IssueProvider } from '../issue/issue.model';

describe('IssuePanelComponent', () => {
  let fixture: ComponentFixture<IssuePanelComponent>;
  let providers$: BehaviorSubject<IssueProvider[]>;
  let isRegistered: boolean;
  const registrationVersion = signal(0);

  beforeEach(async () => {
    providers$ = new BehaviorSubject<IssueProvider[]>([]);
    isRegistered = false;
    const store = jasmine.createSpyObj<Store>('Store', ['select', 'dispatch']);
    store.select.and.returnValue(providers$);

    await TestBed.configureTestingModule({
      imports: [
        IssuePanelComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateNoOpLoader },
        }),
      ],
      providers: [
        { provide: Store, useValue: store },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        { provide: WorkContextService, useValue: { activeWorkContextId: 'ctx1' } },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            hasProvider: () => isRegistered,
            getAvailableProviders: () => [],
            registrationVersion,
          },
        },
        {
          provide: PluginService,
          useValue: { getDisabledIssueProviderPlugins: () => [] },
        },
        { provide: TaskService, useValue: { allTasks$: of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IssuePanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create and render the provider tab group', () => {
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.nativeElement.querySelector('mat-tab-group')).toBeTruthy();
  });

  it('should not render the intro with no providers configured', () => {
    expect(fixture.nativeElement.querySelector('issue-panel-intro')).toBeNull();
  });

  it('stops marking a configured provider missing once its plugin registers', () => {
    providers$.next([
      {
        id: 'provider-1',
        issueProviderKey: 'plugin:github',
        pluginId: 'github',
        isEnabled: true,
      } as unknown as IssueProvider,
    ]);
    const mapped = fixture.componentInstance.issueProvidersMapped;
    expect(mapped()[0].missingPluginName).toBe('github');
    expect(mapped()[0].issueProvider.isEnabled).toBe(false);

    isRegistered = true;
    registrationVersion.update((v) => v + 1);

    expect(mapped()[0].missingPluginName).toBeUndefined();
    expect(mapped()[0].issueProvider.isEnabled).toBe(true);
  });
});
