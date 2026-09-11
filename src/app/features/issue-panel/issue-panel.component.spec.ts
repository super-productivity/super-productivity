import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
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

describe('IssuePanelComponent', () => {
  let fixture: ComponentFixture<IssuePanelComponent>;

  beforeEach(async () => {
    const store = jasmine.createSpyObj<Store>('Store', ['select', 'dispatch']);
    store.select.and.returnValue(of([]));

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
          useValue: { hasProvider: () => false, getAvailableProviders: () => [] },
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
});
