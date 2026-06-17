import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TaskAttachmentListComponent } from './task-attachment-list.component';
import { TaskAttachmentService } from '../task-attachment.service';
import { SnackService } from '../../../../core/snack/snack.service';
import { MatDialog } from '@angular/material/dialog';
import { TaskAttachment } from '../task-attachment.model';
import { T } from '../../../../t.const';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ClipboardImageService } from '../../../../core/clipboard-image/clipboard-image.service';
import { Log } from '../../../../core/log';

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
      'resolveIndexedDbUrl',
      'resolveClipboardImageUrl',
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

  describe('resolvedAttachments img src safety (GHSA-hr87-735w-hfq3)', () => {
    const imgAttachment = (path: string): TaskAttachment => ({
      id: 'a',
      type: 'IMG',
      title: 'x',
      path,
    });

    it('drops remote file:// / UNC src so the <img> cannot auto-load and leak NTLM', () => {
      [
        'file://192.168.1.100/share/pixel.png',
        'file:////host/share/pixel.png',
        'file:///%5C%5Chost/share/pixel.png',
        'file:///%2F%2Fhost/share/pixel.png',
        'file:///%2e%2e/%2F%2Fhost/share/pixel.png',
        '\\\\host\\share\\pixel.png',
        '//host/share/pixel.png',
      ].forEach((path) => {
        fixture.componentRef.setInput('attachments', [imgAttachment(path)]);
        expect(component.resolvedAttachments()[0].resolvedOriginalPath).toBeUndefined();
      });
    });

    it('keeps safe srcs (local file://, http(s), data:)', () => {
      [
        'file:///home/user/img.png',
        'https://example.com/img.png',
        'data:image/png;base64,iVBORw0KGgo=',
      ].forEach((path) => {
        fixture.componentRef.setInput('attachments', [imgAttachment(path)]);
        expect(component.resolvedAttachments()[0].resolvedOriginalPath).toBe(path);
      });
    });

    it('treats clipboard-images file:/// paths as resolvable (returns raw path until async resolved)', () => {
      const path =
        'file:///C:/Users/user/AppData/Roaming/superProductivity/clipboard-images/abc123.png';
      fixture.componentRef.setInput('attachments', [imgAttachment(path)]);
      // Before async resolution the raw path is returned; isPathSafeToOpen passes it through
      expect(component.resolvedAttachments()[0].resolvedOriginalPath).toBe(path);
    });

    it('treats indexeddb:// clipboard-images paths as resolvable (returns raw url until async resolved)', () => {
      const path = 'indexeddb://clipboard-images/abc123';
      fixture.componentRef.setInput('attachments', [imgAttachment(path)]);
      // resolvedOriginalPath is the raw indexeddb url until the effect resolves it
      expect(component.resolvedAttachments()[0].resolvedOriginalPath).toBe(path);
    });
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
      spyOn(Log, 'warn');

      await component.copy(attachment);

      expect(writeTextSpy).toHaveBeenCalledWith('https://example.com/test');
      expect(Log.warn).toHaveBeenCalled();
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
      spyOn(Log, 'err');

      await component.copy(attachment);

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(Log.err).toHaveBeenCalled();
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
