import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
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
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MarkdownModule } from 'ngx-markdown';
import { of } from 'rxjs';
import { ComponentRef, NO_ERRORS_SCHEMA } from '@angular/core';
import { DEFAULT_TASK, TaskWithSubTasks } from '../task.model';

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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskDetailPanelComponent);
    componentRef = fixture.componentRef;
    component = fixture.componentInstance;
    componentRef.setInput('task', MOCK_TASK);
    fixture.detectChanges();
  });

  const createPasteEvent = (target: HTMLElement): ClipboardEvent => {
    const event = new ClipboardEvent('paste', { bubbles: true });
    Object.defineProperty(event, 'target', { value: target, configurable: true });
    return event;
  };

  describe('onPaste', () => {
    it('should add attachment when image is pasted on panel', fakeAsync(async () => {
      const imageUrl = 'indexeddb://clipboard-images/test-id';
      mockClipboardImageService.handlePasteWithProgress.and.returnValue({
        placeholderText: '![Saving image...]()',
        resultPromise: Promise.resolve({ success: true, imageUrl }),
      });

      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget);

      await component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).toHaveBeenCalledWith(
        event,
      );
      expect(mockAttachmentService.addAttachment).toHaveBeenCalledWith(
        MOCK_TASK.id,
        jasmine.objectContaining({ type: 'IMG', path: imageUrl }),
      );
    }));

    it('should NOT intercept paste when target is textarea', fakeAsync(async () => {
      const textarea = document.createElement('textarea');
      const event = createPasteEvent(textarea);

      await component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT intercept paste when target is input', fakeAsync(async () => {
      const input = document.createElement('input');
      const event = createPasteEvent(input);

      await component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT intercept paste when target is contenteditable', fakeAsync(async () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      const event = createPasteEvent(div);

      await component.onPaste(event);
      tick();

      expect(mockClipboardImageService.handlePasteWithProgress).not.toHaveBeenCalled();
      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT add attachment when clipboard has no image', fakeAsync(async () => {
      mockClipboardImageService.handlePasteWithProgress.and.returnValue(null);

      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget);

      await component.onPaste(event);
      tick();

      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));

    it('should NOT add attachment when image save fails', fakeAsync(async () => {
      mockClipboardImageService.handlePasteWithProgress.and.returnValue({
        placeholderText: '![Saving image...]()',
        resultPromise: Promise.resolve({ success: false }),
      });

      const divTarget = document.createElement('div');
      const event = createPasteEvent(divTarget);

      await component.onPaste(event);
      tick();

      expect(mockAttachmentService.addAttachment).not.toHaveBeenCalled();
    }));
  });
});
