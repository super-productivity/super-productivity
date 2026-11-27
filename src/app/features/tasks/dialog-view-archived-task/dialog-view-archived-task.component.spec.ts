import { ComponentFixture, TestBed } from '@angular/core/testing';
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
  let restoreService: jasmine.SpyObj<RestoreArchivedTaskService>;
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
    projectId: 'project',
  };

  const createDialog = async (restorableTask: Task | null): Promise<void> => {
    restoreService.findRestorableTask.and.resolveTo(restorableTask);
    fixture = TestBed.createComponent(DialogViewArchivedTaskComponent);
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const restoreBtn = (): HTMLButtonElement | undefined =>
    fixture.debugElement.query(By.css(RESTORE_BTN))?.nativeElement;

  beforeEach(async () => {
    restoreService = jasmine.createSpyObj<RestoreArchivedTaskService>(
      'RestoreArchivedTaskService',
      ['findRestorableTask', 'confirmAndRestore'],
    );
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
        { provide: RestoreArchivedTaskService, useValue: restoreService },
        { provide: NavigateToTaskService, useValue: navigateToTaskService },
        { provide: TaskArchiveService, useValue: {} },
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
    await createDialog(null);

    expect(restoreService.findRestorableTask).toHaveBeenCalledOnceWith(task);
    expect(restoreBtn()).toBeUndefined();
  });

  it('offers restore as a regular, focusable button', async () => {
    await createDialog(parent);

    expect(restoreBtn()?.tagName).toBe('BUTTON');
    expect(restoreBtn()?.disabled).toBe(false);
  });

  it('restores the restorable task, closes and goes to it', async () => {
    await createDialog(parent);
    restoreService.confirmAndRestore.and.resolveTo(true);

    restoreBtn()?.click();
    await fixture.whenStable();

    expect(restoreService.confirmAndRestore).toHaveBeenCalledOnceWith(parent);
    expect(dialogRef.close).toHaveBeenCalledTimes(1);
    expect(navigateToTaskService.navigate).toHaveBeenCalledOnceWith('parent');
  });

  it('stays open when the confirmation is declined', async () => {
    await createDialog(parent);
    restoreService.confirmAndRestore.and.resolveTo(false);

    restoreBtn()?.click();
    await fixture.whenStable();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(navigateToTaskService.navigate).not.toHaveBeenCalled();
  });
});
