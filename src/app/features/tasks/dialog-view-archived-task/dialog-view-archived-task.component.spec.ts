import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { selectTaskEntities } from '../store/task.selectors';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogViewArchivedTaskComponent } from './dialog-view-archived-task.component';
import { RestoreArchivedTaskService } from '../restore-archived-task.service';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { IssueService } from '../../issue/issue.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { DEFAULT_TASK, Task } from '../task.model';

const RESTORE_BTN = '.e2e-restore-archived-task';

describe('DialogViewArchivedTaskComponent', () => {
  let fixture: ComponentFixture<DialogViewArchivedTaskComponent>;
  let confirmAndRestore: jasmine.Spy<RestoreArchivedTaskService['confirmAndRestore']>;
  let navigateToTaskService: jasmine.SpyObj<NavigateToTaskService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogViewArchivedTaskComponent>>;

  const task: Task = {
    ...DEFAULT_TASK,
    id: 'sub',
    title: 'Sub',
    parentId: 'parent',
    projectId: 'project',
  };
  const parent: Task = {
    ...DEFAULT_TASK,
    id: 'parent',
    title: 'Parent',
    subTaskIds: [task.id],
    projectId: 'project',
  };

  const archive = { ids: ['sub', 'parent'], entities: { sub: task, parent } };
  let loadArchive: jasmine.Spy<TaskArchiveService['load']>;

  const createDialog = async (displayedTask = task): Promise<void> => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { task: displayedTask } });
    confirmAndRestore = spyOn(
      TestBed.inject(RestoreArchivedTaskService),
      'confirmAndRestore',
    );
    fixture = TestBed.createComponent(DialogViewArchivedTaskComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const restoreBtn = (): HTMLButtonElement | undefined =>
    fixture.debugElement.query(By.css(RESTORE_BTN))?.nativeElement;

  beforeEach(async () => {
    loadArchive = jasmine.createSpy('load').and.resolveTo(archive);
    navigateToTaskService = jasmine.createSpyObj<NavigateToTaskService>(
      'NavigateToTaskService',
      ['navigate'],
    );
    navigateToTaskService.navigate.and.resolveTo();
    dialogRef = jasmine.createSpyObj<MatDialogRef<DialogViewArchivedTaskComponent>>(
      'MatDialogRef',
      ['close'],
    );

    await TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot(), DialogViewArchivedTaskComponent],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { task } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MatDialog, useValue: {} },
        provideMockStore({ selectors: [{ selector: selectTaskEntities, value: {} }] }),
        { provide: NavigateToTaskService, useValue: navigateToTaskService },
        { provide: TaskArchiveService, useValue: { load: loadArchive } },
        { provide: TaskRepeatCfgService, useValue: {} },
        { provide: IssueService, useValue: {} },
        {
          provide: DateTimeFormatService,
          useValue: { currentLocale: () => 'en-US' },
        },
      ],
    }).compileComponents();
  });

  it('offers no restore for a task that cannot be restored', async () => {
    loadArchive.and.resolveTo({ ids: [], entities: {} });
    await createDialog();

    expect(restoreBtn()).toBeUndefined();
  });

  it('opens the details of an active leaf without reading the archive', async () => {
    const leaf = { ...parent, subTaskIds: [] };
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: { task: leaf } });
    const store = TestBed.inject(MockStore);
    store.overrideSelector(selectTaskEntities, { [leaf.id]: leaf });
    store.refreshState();

    fixture = TestBed.createComponent(DialogViewArchivedTaskComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(loadArchive).not.toHaveBeenCalled();
    expect(restoreBtn()).toBeUndefined();
  });

  it('loads the archive once to show both the restore target and the subtasks', async () => {
    await createDialog(parent);

    expect(loadArchive).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.subTasks()).toEqual([task]);
    expect(restoreBtn()).toBeDefined();
  });

  it('offers restore as a regular, focusable button', async () => {
    await createDialog();

    expect(restoreBtn()?.tagName).toBe('BUTTON');
    expect(restoreBtn()?.disabled).toBe(false);
  });

  it('restores the restorable task, closes and goes to it', async () => {
    await createDialog();
    confirmAndRestore.and.resolveTo(true);

    restoreBtn()?.click();
    await fixture.whenStable();

    expect(confirmAndRestore).toHaveBeenCalledOnceWith(parent);
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(navigateToTaskService.navigate).toHaveBeenCalledOnceWith('parent');
  });

  it('stays open when the confirmation is declined', async () => {
    await createDialog();
    confirmAndRestore.and.resolveTo(false);

    restoreBtn()?.click();
    await fixture.whenStable();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(navigateToTaskService.navigate).not.toHaveBeenCalled();
  });
});
