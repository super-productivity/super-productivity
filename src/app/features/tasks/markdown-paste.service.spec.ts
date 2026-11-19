import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { MarkdownPasteService } from './markdown-paste.service';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_TASK } from './task.model';

describe('MarkdownPasteService', () => {
  let service: MarkdownPasteService;
  let taskService: jasmine.SpyObj<TaskService>;

  const PASTED_LIST = '- First\n  - Child\n- Second';

  const addedParents = (): unknown[][] =>
    taskService.add.calls
      .allArgs()
      .map(([title, isAddToBacklog, , isAddToBottom]) => [
        title,
        isAddToBacklog,
        isAddToBottom,
      ]);

  beforeEach(() => {
    taskService = jasmine.createSpyObj<TaskService>('TaskService', [
      'add',
      'createNewTaskWithDefaults',
    ]);
    taskService.add.and.callFake((title) => `id-${title}`);
    taskService.createNewTaskWithDefaults.and.callFake(({ title, additional }) => ({
      ...DEFAULT_TASK,
      ...additional,
      id: `id-${title}`,
      title: title as string,
      projectId: 'project-1',
    }));

    TestBed.configureTestingModule({
      providers: [
        MarkdownPasteService,
        { provide: TaskService, useValue: taskService },
        { provide: Store, useValue: jasmine.createSpyObj<Store>('Store', ['dispatch']) },
        {
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(true) }) },
        },
        { provide: GlobalConfigService, useValue: { cfg: () => undefined } },
      ],
    });
    service = TestBed.inject(MarkdownPasteService);
  });

  it('appends pasted parent tasks to the active list by default', async () => {
    await service.handleMarkdownPaste(PASTED_LIST, null);

    expect(addedParents()).toEqual([
      ['First', false, true],
      ['Second', false, true],
    ]);
  });

  it('prepends pasted parent tasks to the backlog in their pasted order', async () => {
    await service.handleMarkdownPaste(PASTED_LIST, null, undefined, undefined, {
      isAddToBacklog: true,
      isAddToBottom: false,
    });

    // Each prepend lands above the previous one, so the last task is added first.
    expect(addedParents()).toEqual([
      ['Second', true, false],
      ['First', true, false],
    ]);
    expect(taskService.createNewTaskWithDefaults).toHaveBeenCalledWith(
      jasmine.objectContaining({
        title: 'Child',
        additional: jasmine.objectContaining({ parentId: 'id-First' }),
      }),
    );
  });
});
