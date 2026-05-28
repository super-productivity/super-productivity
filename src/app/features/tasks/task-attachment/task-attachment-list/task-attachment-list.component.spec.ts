import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskAttachmentListComponent } from './task-attachment-list.component';
import { TaskAttachmentService } from '../task-attachment.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskAttachment } from '../task-attachment.model';
import { T } from '../../../../t.const';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ClipboardImageService } from '../../../../core/clipboard-image/clipboard-image.service';

describe('TaskAttachmentListComponent', () => {
  let component: TaskAttachmentListComponent;
  let fixture: ComponentFixture<TaskAttachmentListComponent>;
  let snackService: jasmine.SpyObj<SnackService>;

  beforeEach(async () => {
    const snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    const attachmentServiceSpy = jasmine.createSpyObj('TaskAttachmentService', [
      'addAttachment',
      'updateAttachment',
      'deleteAttachment',
    ]);
    const matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    const clipboardImageServiceSpy = jasmine.createSpyObj('ClipboardImageService', [
      'resolveUrl',
    ]);

    await TestBed.configureTestingModule({
      imports: [TaskAttachmentListComponent, NoopAnimationsModule],
      providers: [
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: TaskAttachmentService, useValue: attachmentServiceSpy },
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: ClipboardImageService, useValue: clipboardImageServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TaskAttachmentListComponent);
    component = fixture.componentInstance;
    snackService = TestBed.inject(SnackService) as jasmine.SpyObj<SnackService>;
  });

  describe('copy', () => {
    let attachment: TaskAttachment;
    let originalClipboardDescriptor: PropertyDescriptor | undefined;
    let originalExecCommand: typeof document.execCommand;

    const setNavigatorClipboard = (clipboard: Partial<Clipboard> | undefined): void => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: clipboard,
        writable: true,
      });
    };

    beforeEach(() => {
      attachment = {
        id: 'test-id',
        path: 'https://example.com/test',
        title: 'Test Link',
        type: 'LINK',
      };
      originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
        navigator,
        'clipboard',
      );
      originalExecCommand = document.execCommand;
    });

    afterEach(() => {
      // Restore original implementations
      if (originalClipboardDescriptor) {
        Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
      } else {
        delete (navigator as { clipboard?: Clipboard }).clipboard;
      }
      originalClipboardDescriptor = undefined;
      document.execCommand = originalExecCommand;
    });

    it('should not copy if attachment is undefined', async () => {
      await component.copy(undefined);
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should not copy if attachment path is missing', async () => {
      const attachmentWithoutPath = { ...attachment, path: undefined };
      await component.copy(attachmentWithoutPath);
      expect(snackService.open).not.toHaveBeenCalled();
    });

    it('should copy using modern clipboard API when available', async () => {
      const writeTextSpy = jasmine
        .createSpy('writeText')
        .and.returnValue(Promise.resolve());
      setNavigatorClipboard({ writeText: writeTextSpy });

      await component.copy(attachment);

      expect(writeTextSpy).toHaveBeenCalledWith('https://example.com/test');
      expect(snackService.open).toHaveBeenCalledWith(T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD);
    });

    it('should use fallback method when clipboard API is not available', async () => {
      setNavigatorClipboard(undefined);
      document.execCommand = jasmine.createSpy('execCommand').and.returnValue(true);

      await component.copy(attachment);

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(snackService.open).toHaveBeenCalledWith(T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD);
    });

    it('should use fallback method when clipboard API throws error', async () => {
      const writeTextSpy = jasmine
        .createSpy('writeText')
        .and.returnValue(Promise.reject(new Error('Permission denied')));
      setNavigatorClipboard({ writeText: writeTextSpy });
      document.execCommand = jasmine.createSpy('execCommand').and.returnValue(true);
      spyOn(console, 'warn');

      await component.copy(attachment);

      expect(writeTextSpy).toHaveBeenCalledWith('https://example.com/test');
      expect(console.warn).toHaveBeenCalled();
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(snackService.open).toHaveBeenCalledWith(T.GLOBAL_SNACK.COPY_TO_CLIPPBOARD);
    });

    it('should show error message when fallback copy fails', async () => {
      setNavigatorClipboard(undefined);
      document.execCommand = jasmine.createSpy('execCommand').and.returnValue(false);

      await component.copy(attachment);

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(snackService.open).toHaveBeenCalledWith({
        msg: 'Failed to copy to clipboard. Please copy manually.',
        type: 'ERROR',
      });
    });

    it('should show error message when fallback copy throws error', async () => {
      setNavigatorClipboard(undefined);
      document.execCommand = jasmine
        .createSpy('execCommand')
        .and.throwError('Command not supported');
      spyOn(console, 'error');

      await component.copy(attachment);

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(console.error).toHaveBeenCalled();
      expect(snackService.open).toHaveBeenCalledWith({
        msg: 'Failed to copy to clipboard. Please copy manually.',
        type: 'ERROR',
      });
    });

    it('should create and remove textarea element for fallback copy', async () => {
      setNavigatorClipboard(undefined);
      document.execCommand = jasmine.createSpy('execCommand').and.returnValue(true);

      const appendChildSpy = spyOn(document.body, 'appendChild').and.callThrough();
      const removeChildSpy = spyOn(document.body, 'removeChild').and.callThrough();

      await component.copy(attachment);

      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();

      // Check that textarea was created with correct properties
      const textarea = appendChildSpy.calls.mostRecent().args[0] as HTMLTextAreaElement;
      expect(textarea.value).toBe('https://example.com/test');
      expect(textarea.style.position).toBe('fixed');
      expect(textarea.style.opacity).toBe('0');
    });
  });
});
