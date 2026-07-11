import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ComponentRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { EMPTY, of } from 'rxjs';
import { TaskDetailPanelComponent } from './task-detail-panel.component';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import { TaskAttachmentService } from '../task-attachment/task-attachment.service';
import { TaskService } from '../task.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { IssueService } from '../../issue/issue.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { MatDialog } from '@angular/material/dialog';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { Store } from '@ngrx/store';
import { MentionConfigService } from '../mention-config.service';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MarkdownModule } from 'ngx-markdown';
import { DEFAULT_TASK, TaskDetailTargetPanel, TaskWithSubTasks } from '../task.model';
import { TaskDetailItemComponent } from './task-additional-info-item/task-detail-item.component';

const MOCK_TASK: TaskWithSubTasks = {
  ...(DEFAULT_TASK as TaskWithSubTasks),
  id: 'test-task-id',
  title: 'Test Task',
  subTasks: [],
  attachments: [],
};

describe('TaskDetailPanelComponent paste handler', () => {
  let component: TaskDetailPanelComponent;
  let fixture: ComponentFixture<TaskDetailPanelComponent>;
  let componentRef: ComponentRef<TaskDetailPanelComponent>;
  let mockClipboardImageService: jasmine.SpyObj<ClipboardImageService>;
  let mockAttachmentService: jasmine.SpyObj<TaskAttachmentService>;

  beforeEach(async () => {
    mockClipboardImageService = jasmine.createSpyObj('ClipboardImageService', [
      'handlePasteWithProgress',
    ]);
    mockAttachmentService = jasmine.createSpyObj('TaskAttachmentService', [
      'addAttachment',
      'createFromDrop',
    ]);
    const mockTaskService = jasmine.createSpyObj(
      'TaskService',
      ['update', 'setSelectedId', 'focusTaskIfPossible', 'addSubTaskTo'],
      {
        taskDetailPanelTargetPanel$: of(null),
        selectedTaskId: jasmine.createSpy().and.returnValue(null),
      },
    );
    const mockLayoutService = jasmine.createSpyObj('LayoutService', [], {
      isShowList: jasmine.createSpy().and.returnValue(true),
    });
    const mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg: jasmine.createSpy().and.returnValue({ keyboard: {} }),
      tasks: jasmine.createSpy().and.returnValue({}),
      clipboardImages: jasmine.createSpy().and.returnValue(null),
    });
    const mockIssueService = jasmine.createSpyObj(
      'IssueService',
      ['getById$', 'getMappedAttachments'],
      {},
    );
    mockIssueService.getById$.and.returnValue(of(null));
    mockIssueService.getMappedAttachments.and.returnValue([]);

    const mockTaskRepeatCfgService = jasmine.createSpyObj('TaskRepeatCfgService', [
      'getTaskRepeatCfgByIdAllowUndefined$',
    ]);
    mockTaskRepeatCfgService.getTaskRepeatCfgByIdAllowUndefined$.and.returnValue(
      of(null),
    );

    const mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    const mockDateTimeFormatService = jasmine.createSpyObj(
      'DateTimeFormatService',
      ['formatDateTime'],
      {
        currentLocale: jasmine.createSpy().and.returnValue('en'),
      },
    );
    const mockStore = jasmine.createSpyObj('Store', ['select', 'dispatch', 'pipe']);
    mockStore.select.and.returnValue(of([]));
    mockStore.pipe.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [
        TaskDetailPanelComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        MarkdownModule.forRoot(),
      ],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: ClipboardImageService, useValue: mockClipboardImageService },
        { provide: TaskAttachmentService, useValue: mockAttachmentService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: IssueService, useValue: mockIssueService },
        { provide: TaskRepeatCfgService, useValue: mockTaskRepeatCfgService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: DateTimeFormatService, useValue: mockDateTimeFormatService },
        { provide: Store, useValue: mockStore },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskDetailPanelComponent);
    componentRef = fixture.componentRef;
    component = fixture.componentInstance;
    componentRef.setInput('task', MOCK_TASK);
    fixture.detectChanges();
  });

  const createPasteEvent = (
    target: HTMLElement,
    types: string[] = [],
  ): ClipboardEvent => {
    const event = new ClipboardEvent('paste', { bubbles: true });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { types },
      configurable: true,
    });
    return event;
  };

  describe('onPaste', () => {
    it('should add attachment when image is pasted on panel', fakeAsync(() => {
      const imageUrl = 'indexeddb://clipboard-images/test-id';
      mockClipboardImageService.handlePasteWithProgress.and.returnValue({
        placeholderText: '![Saving image...]()',
        resultPromise: Promise.resolve({ success: true, imageUrl }),
      });

      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget, ['Files']);

      component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).toHaveBeenCalledWith(
        event,
      );
      expect(mockAttachmentService.addAttachment).toHaveBeenCalledWith(
        MOCK_TASK.id,
        jasmine.objectContaining({ type: 'IMG', path: imageUrl }),
      );
    }));

    it('should NOT intercept paste when target is textarea', fakeAsync(() => {
      const textarea = document.createElement('textarea');
      const event = createPasteEvent(textarea);

      component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT intercept paste when target is input', fakeAsync(() => {
      const input = document.createElement('input');
      const event = createPasteEvent(input);

      component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT intercept paste when target is contenteditable', fakeAsync(() => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      const event = createPasteEvent(div);

      component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT intercept paste when clipboard contains text (e.g. OneNote)', fakeAsync(() => {
      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget, ['text/plain', 'Files']);

      component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT add attachment when clipboard has no image', fakeAsync(() => {
      mockClipboardImageService.handlePasteWithProgress.and.returnValue(null);

      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget, ['Files']);

      component.onPaste(event);
      tick();

      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT add attachment when image save fails', fakeAsync(() => {
      mockClipboardImageService.handlePasteWithProgress.and.returnValue({
        placeholderText: '![Saving image...]()',
        resultPromise: Promise.resolve({ success: false }),
      });

      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget, ['Files']);

      component.onPaste(event);
      tick();

      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));
  });
});

const fakeTask = (id: string): TaskWithSubTasks =>
  ({ id, subTasks: [], tagIds: [] }) as unknown as TaskWithSubTasks;

/**
 * Regression coverage for the #6578 stale-focus race: a deferred auto-focus
 * scheduled while the panel showed one task must not steal focus once the
 * panel has switched to a different task (e.g. the user arrow-navigated the
 * list). The e2e suite only surfaces this under load, so the timing is proven
 * deterministically here with fakeAsync.
 */
describe('TaskDetailPanelComponent stale-focus guard', () => {
  let component: TaskDetailPanelComponent;
  let fixture: ComponentFixture<TaskDetailPanelComponent>;

  const makeItem = (): TaskDetailItemComponent =>
    ({
      elementRef: { nativeElement: { focus: jasmine.createSpy('focus') } },
    }) as unknown as TaskDetailItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskDetailPanelComponent],
      providers: [
        {
          provide: TaskService,
          useValue: {
            taskDetailPanelTargetPanel$: EMPTY,
            selectedTaskId: () => undefined,
            getByIdWithSubTaskData$: () => of(null),
            update: () => undefined,
            setSelectedId: () => undefined,
            focusTaskIfPossible: () => undefined,
          },
        },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: ClipboardImageService, useValue: {} },
        { provide: LayoutService, useValue: {} },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        { provide: IssueService, useValue: { getById$: () => of(null) } },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgByIdAllowUndefined$: () => of(null) },
        },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
        { provide: MatDialog, useValue: {} },
        { provide: Store, useValue: { select: () => EMPTY, dispatch: () => undefined } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
      ],
    })
      // Drop the real template/child components — only the focus timing logic is under test.
      .overrideComponent(TaskDetailPanelComponent, {
        set: { template: '', imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskDetailPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', fakeTask('B'));
    fixture.detectChanges();
  });

  it('does not auto-focus the panel when the task changed before the timer fires', fakeAsync(() => {
    // One rendered item so the unguarded code path *would* call focusItem.
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [makeItem()];
    const focusItemSpy = spyOn(component, 'focusItem');

    // Scheduled while showing task B...
    (component as unknown as { _focusFirst: () => void })._focusFirst();
    // ...then the user navigates the list to task A before the 150ms timer fires.
    fixture.componentRef.setInput('task', fakeTask('A'));

    tick(200);

    expect(focusItemSpy).not.toHaveBeenCalled();
  }));

  it('auto-focuses the first item when the task is unchanged', fakeAsync(() => {
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [makeItem()];
    const focusItemSpy = spyOn(component, 'focusItem');

    (component as unknown as { _focusFirst: () => void })._focusFirst();

    tick(200);

    expect(focusItemSpy).toHaveBeenCalled();
  }));

  it('focusItem does not steal focus once the panel switched tasks', fakeAsync(() => {
    const item = makeItem();
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [item];

    component.focusItem(item, 0);
    fixture.componentRef.setInput('task', fakeTask('A'));

    tick(50);

    expect(item.elementRef.nativeElement.focus).not.toHaveBeenCalled();
  }));

  // A late panel auto-focus must not blur an open "add subtask" draft: the
  // draft's blur handler closes it, which left "Add subtask" silently broken
  // when opened from the Planner under load (#8617/#8630).
  it('does not steal focus from an open add-subtask draft', fakeAsync(() => {
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [makeItem()];
    const focusItemSpy = spyOn(component, 'focusItem');

    // The user opened the inline draft (it owns focus)...
    component.isAddSubtaskInputVisible.set(true);
    // ...then the on-open auto-focus timer fires late.
    (component as unknown as { _focusFirst: () => void })._focusFirst();

    tick(200);

    expect(focusItemSpy).not.toHaveBeenCalled();
  }));
});

// Opening the notes panel via a checklist's progress badge routes through
// TaskDetailTargetPanel.Notes. It must land on the RENDERED checklist (preview),
// not auto-open the raw-markdown editor: doing both briefly flashed the raw
// "- [ ] " source before focusItem() blurred the editor back to preview.
describe('TaskDetailPanelComponent notes target does not auto-edit', () => {
  let component: TaskDetailPanelComponent;
  let fixture: ComponentFixture<TaskDetailPanelComponent>;

  const makeItem = (): TaskDetailItemComponent =>
    ({
      elementRef: { nativeElement: { focus: jasmine.createSpy('focus') } },
    }) as unknown as TaskDetailItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskDetailPanelComponent],
      providers: [
        {
          provide: TaskService,
          useValue: {
            taskDetailPanelTargetPanel$: of(TaskDetailTargetPanel.Notes),
            selectedTaskId: () => 'B',
            getByIdWithSubTaskData$: () => of(null),
            update: () => undefined,
            setSelectedId: () => undefined,
            focusTaskIfPossible: () => undefined,
          },
        },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: ClipboardImageService, useValue: {} },
        { provide: LayoutService, useValue: {} },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        { provide: IssueService, useValue: { getById$: () => of(null) } },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgByIdAllowUndefined$: () => of(null) },
        },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
        { provide: MatDialog, useValue: {} },
        { provide: Store, useValue: { select: () => EMPTY, dispatch: () => undefined } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
      ],
    })
      .overrideComponent(TaskDetailPanelComponent, {
        set: { template: '', imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskDetailPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', fakeTask('B'));
  });

  it('focuses the notes section without entering edit mode', fakeAsync(() => {
    // Provide a notes wrapper so the real focus path (not the devError branch) runs.
    const noteItem = makeItem();
    (
      component as unknown as { noteWrapperElRef: () => TaskDetailItemComponent }
    ).noteWrapperElRef = () => noteItem;
    const focusItemSpy = spyOn(component, 'focusItem');

    fixture.detectChanges(); // ngAfterViewInit subscribes; target emits after delay(50)
    // Advance beyond the delay instead of relying on tasks scheduled for the
    // exact same virtual timestamp.
    tick(100);

    // The notes section is focused...
    expect(focusItemSpy).toHaveBeenCalledWith(noteItem);
    // ...but the editor is NOT auto-opened (no raw-text flash).
    expect(component.panelState.isFocusNotes()).toBe(false);
  }));
});

/**
 * Coverage for adding a sub-task while the detail panel is open. When focus is
 * inside the panel the global task-shortcut handler can't resolve a focused
 * task, so the panel routes the add-subtask shortcut itself. Focusing the new
 * sub-task is handled by TaskService.focusTaskById (covered separately).
 */
describe('TaskDetailPanelComponent add sub-task', () => {
  let fixture: ComponentFixture<TaskDetailPanelComponent>;
  let component: TaskDetailPanelComponent;
  let addSubTaskToSpy: jasmine.Spy;

  const keydown = (key: string, target: HTMLElement): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', {
      key,
      code: `Key${key.toUpperCase()}`,
      bubbles: true,
    });
    Object.defineProperty(ev, 'target', { value: target, configurable: true });
    return ev;
  };

  beforeEach(async () => {
    addSubTaskToSpy = jasmine.createSpy('addSubTaskTo').and.returnValue('new-sub-id');

    await TestBed.configureTestingModule({
      imports: [TaskDetailPanelComponent],
      providers: [
        {
          provide: TaskService,
          useValue: {
            taskDetailPanelTargetPanel$: EMPTY,
            selectedTaskId: () => undefined,
            getByIdWithSubTaskData$: () => of(null),
            update: () => undefined,
            setSelectedId: () => undefined,
            focusTaskIfPossible: () => undefined,
            addSubTaskTo: addSubTaskToSpy,
            showSubTasks: () => undefined,
            focusTaskById: () => undefined,
          },
        },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: ClipboardImageService, useValue: {} },
        { provide: LayoutService, useValue: {} },
        {
          provide: GlobalConfigService,
          useValue: { cfg: () => ({ keyboard: { taskAddSubTask: 'a' } }) },
        },
        { provide: IssueService, useValue: { getById$: () => of(null) } },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgByIdAllowUndefined$: () => of(null) },
        },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
        { provide: MatDialog, useValue: {} },
        { provide: Store, useValue: { select: () => EMPTY, dispatch: () => undefined } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
        { provide: MentionConfigService, useValue: { mentionConfig$: EMPTY } },
      ],
    })
      .overrideComponent(TaskDetailPanelComponent, {
        set: { template: '', imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskDetailPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', fakeTask('P'));
    fixture.detectChanges();
  });

  it('shows the inline subtask input in the panel for a top-level task', () => {
    component.addSubTask();
    // The input is hosted by the panel itself (not delegated to a <task> row),
    // so it works regardless of which view opened the panel (#8617).
    expect(component.isAddSubtaskInputVisible()).toBe(true);
    expect(component.isSubTasksExpanded()).toBe(true);
    expect(addSubTaskToSpy).not.toHaveBeenCalled();
  });

  it('creates a sibling directly when adding a subtask from a subtask panel', () => {
    const subFixture = TestBed.createComponent(TaskDetailPanelComponent);
    const subComponent = subFixture.componentInstance;
    subFixture.componentRef.setInput('task', {
      id: 'SUB',
      parentId: 'P',
      subTasks: [],
      tagIds: [],
    } as unknown as TaskWithSubTasks);
    subFixture.detectChanges();

    subComponent.addSubTask();

    expect(addSubTaskToSpy).toHaveBeenCalledWith('P');
    expect(subComponent.isAddSubtaskInputVisible()).toBe(false);
  });

  it('hides the input again when it is closed', () => {
    component.addSubTask();
    expect(component.isAddSubtaskInputVisible()).toBe(true);
    component.onAddSubtaskInputClosed('blur');
    expect(component.isAddSubtaskInputVisible()).toBe(false);
    // The section stays expanded so the just-added subtasks remain visible.
    expect(component.isSubTasksExpanded()).toBe(true);
  });

  it('focuses the last panel subtask on previous navigation', fakeAsync(() => {
    const lastSubtask = document.createElement('task');
    lastSubtask.tabIndex = 0;
    fixture.nativeElement.append(lastSubtask);
    component.isAddSubtaskInputVisible.set(true);

    component.onAddSubtaskInputClosed('prev');
    tick();

    expect(document.activeElement).toBe(lastSubtask);
  }));

  it('focuses the next main-list task on next navigation', fakeAsync(() => {
    const mainList = document.createElement('div');
    const parentTask = document.createElement('task');
    const mainSubtask = document.createElement('task');
    const nextTask = document.createElement('task');
    parentTask.id = 't-P';
    parentTask.tabIndex = 0;
    mainSubtask.tabIndex = 0;
    nextTask.tabIndex = 0;
    parentTask.append(mainSubtask);
    mainList.append(parentTask, nextTask);
    document.body.append(mainList);
    component.isAddSubtaskInputVisible.set(true);

    component.onAddSubtaskInputClosed('next');
    tick();

    expect(document.activeElement).toBe(nextTask);
    mainList.remove();
  }));

  it('keeps focus on the last panel subtask when there is no next task', fakeAsync(() => {
    const mainParentTask = document.createElement('task');
    const panelSubtask = document.createElement('task');
    mainParentTask.id = 't-P';
    mainParentTask.tabIndex = 0;
    panelSubtask.tabIndex = 0;
    document.body.append(mainParentTask);
    fixture.nativeElement.append(panelSubtask);
    component.isAddSubtaskInputVisible.set(true);

    component.onAddSubtaskInputClosed('next');
    tick();

    expect(document.activeElement).toBe(panelSubtask);
    mainParentTask.remove();
  }));

  it('routes the add-subtask shortcut to addSubTask (with prevent/stopPropagation)', () => {
    spyOn(component, 'addSubTask');
    const ev = keydown('a', document.createElement('div'));
    const preventSpy = spyOn(ev, 'preventDefault');
    const stopSpy = spyOn(ev, 'stopPropagation');

    component.onKeydown(ev);

    expect(component.addSubTask).toHaveBeenCalled();
    expect(preventSpy).toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalled();
  });

  it('does not route the shortcut while typing in an input', () => {
    spyOn(component, 'addSubTask');
    component.onKeydown(keydown('a', document.createElement('textarea')));
    expect(component.addSubTask).not.toHaveBeenCalled();
  });
});
