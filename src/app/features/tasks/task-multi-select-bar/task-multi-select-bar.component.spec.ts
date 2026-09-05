import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { TaskMultiSelectBarComponent } from './task-multi-select-bar.component';
import { TaskMultiSelectService } from '../task-multi-select.service';
import { TaskBulkActionService } from '../task-bulk-action.service';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { TaskFocusService } from '../task-focus.service';
import { WorkContextType } from '../../work-context/work-context.model';

describe('TaskMultiSelectBarComponent', () => {
  let fixture: ComponentFixture<TaskMultiSelectBarComponent>;
  let multiSelect: TaskMultiSelectService;
  let taskFocusService: TaskFocusService;
  let routerEvents$: Subject<unknown>;
  let workContext$: Subject<{ activeId: string; activeType: WorkContextType }>;

  beforeEach(async () => {
    routerEvents$ = new Subject();
    workContext$ = new Subject();
    await TestBed.configureTestingModule({
      imports: [
        TaskMultiSelectBarComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        TaskMultiSelectService,
        { provide: Router, useValue: { events: routerEvents$.asObservable() } },
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContextTypeAndId$: workContext$.asObservable(),
            activeWorkContext$: of(undefined),
            isTodayListSignal: signal(false),
          },
        },
        {
          provide: TaskBulkActionService,
          useValue: {
            selectedTasks: signal([]),
            hasUndone: signal(false),
            hasParentTasks: signal(false),
            hasScheduled: signal(false),
            hasDeadline: signal(false),
            hasEstimatable: signal(false),
          },
        },
        {
          provide: ProjectService,
          useValue: { getProjectsWithoutIdInTreeOrder$: () => of([]) },
        },
        {
          provide: TagService,
          useValue: { tagsNoMyDayAndNoListInTreeOrder: signal([]) },
        },
        {
          provide: MenuTreeService,
          useValue: {
            projectFolderMap: signal(new Map()),
            tagFolderMap: signal(new Map()),
          },
        },
        { provide: GlobalConfigService, useValue: { cfg: signal(undefined) } },
        { provide: MatDialog, useValue: { openDialogs: [] } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskMultiSelectBarComponent);
    multiSelect = TestBed.inject(TaskMultiSelectService);
    taskFocusService = TestBed.inject(TaskFocusService);
    fixture.detectChanges();
  });

  it('shows the bar only while something is selected or touch mode is on', () => {
    expect(fixture.nativeElement.querySelector('.bar')).toBeNull();
    multiSelect.toggle('a');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bar')).not.toBeNull();
    multiSelect.toggle('a');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bar')).toBeNull();
    multiSelect.enterTouchSelectionMode();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.bar')).not.toBeNull();
  });

  it('clears the selection on navigation', () => {
    multiSelect.toggle('a');
    routerEvents$.next(new NavigationEnd(1, '/x', '/x'));
    expect(multiSelect.count()).toBe(0);
  });

  it('clears the selection on work-context change', () => {
    multiSelect.toggle('a');
    workContext$.next({ activeId: 'p2', activeType: WorkContextType.PROJECT });
    expect(multiSelect.count()).toBe(0);
  });

  it('the ✕ button clears', () => {
    multiSelect.toggle('a');
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '.bar button[mat-icon-button]',
      ) as HTMLButtonElement
    ).click();
    expect(multiSelect.count()).toBe(0);
  });

  it('registers the open bulk menu as the active closable menu and clears it on close', () => {
    fixture.componentInstance.onMenuOpened();
    expect(taskFocusService.isTaskContextMenuOpen()).toBeTrue();
    expect(taskFocusService.closeActiveTaskContextMenu()).not.toBeNull();
    fixture.componentInstance.onMenuClosed();
    expect(taskFocusService.isTaskContextMenuOpen()).toBeFalse();
    expect(taskFocusService.closeActiveTaskContextMenu()).toBeNull();
  });

  it('clears the selection when the bar is destroyed', () => {
    multiSelect.toggle('a');
    fixture.destroy();
    expect(multiSelect.count()).toBe(0);
  });
});
