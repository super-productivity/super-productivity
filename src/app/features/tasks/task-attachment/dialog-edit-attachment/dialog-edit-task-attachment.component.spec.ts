import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogEditTaskAttachmentComponent } from './dialog-edit-task-attachment.component';
import { TaskAttachment } from '../task-attachment.model';
import { IS_ELECTRON_TOKEN } from '../../../../app.constants';

describe('DialogEditTaskAttachmentComponent', () => {
  let component: DialogEditTaskAttachmentComponent;
  let fixture: ComponentFixture<DialogEditTaskAttachmentComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogEditTaskAttachmentComponent>>;
  let originalEa: typeof window.ea | undefined;

  const setup = (
    attachment?: Partial<TaskAttachment>,
    options: { isElectron?: boolean; allowMultiple?: boolean } = {},
  ): void => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [DialogEditTaskAttachmentComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            attachment: attachment ?? {},
            allowMultiple: options.allowMultiple,
          },
        },
        { provide: IS_ELECTRON_TOKEN, useValue: options.isElectron ?? false },
      ],
    });

    fixture = TestBed.createComponent(DialogEditTaskAttachmentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(() => {
    originalEa = window.ea;
  });

  afterEach(() => {
    if (originalEa === undefined) {
      delete (window as { ea?: typeof window.ea }).ea;
    } else {
      window.ea = originalEa;
    }
  });

  const mockFilePicker = (
    paths: string[] | undefined,
  ): jasmine.Spy<typeof window.ea.showOpenDialog> => {
    const bridge = jasmine.createSpyObj<typeof window.ea>('ElectronAPI', [
      'showOpenDialog',
    ]);
    bridge.showOpenDialog.and.resolveTo(paths);
    window.ea = bridge;
    return bridge.showOpenDialog;
  };

  describe('file picker', () => {
    it('waits for the user to press Choose file and allows removing selections before save', async () => {
      const picker = mockFilePicker(['C:\\Docs\\Rencana kerja.pdf', '/home/me/写真.png']);
      setup(undefined, { isElectron: true, allowMultiple: true });
      component.attachmentCopy.type = 'FILE';

      expect(picker).not.toHaveBeenCalled();
      await component.chooseFile();

      expect(picker).toHaveBeenCalledOnceWith({
        properties: ['openFile', 'multiSelections'],
        title: jasmine.any(String),
      });
      expect(component.selectedFiles().map(({ title }) => title)).toEqual([
        'Rencana kerja.pdf',
        '写真.png',
      ]);
      component.removeSelectedFile(component.selectedFiles()[0].id);
      component.submit();
      expect(dialogRef.close).toHaveBeenCalledWith([
        jasmine.objectContaining({ path: '/home/me/写真.png', title: '写真.png' }),
      ]);
    });

    it('uses single-file selection when editing an existing attachment', async () => {
      const picker = mockFilePicker(['D:\\Files\\Report final.pdf']);
      setup(
        { id: 'attachment-1', type: 'FILE', path: 'D:\\Files\\old.pdf' },
        { isElectron: true },
      );

      await component.chooseFile();

      expect(picker).toHaveBeenCalledWith({
        properties: ['openFile'],
        title: jasmine.any(String),
      });
      expect(component.attachmentCopy.path).toBe('D:\\Files\\Report final.pdf');
      expect(component.attachmentCopy.title).toBe('Report final.pdf');
    });

    it('keeps current selections when the picker is cancelled', async () => {
      mockFilePicker(undefined);
      setup(undefined, { isElectron: true, allowMultiple: true });
      component.selectedFiles.set([
        {
          id: 'file-1',
          type: 'FILE',
          path: 'C:\\Docs\\existing.pdf',
          title: 'existing.pdf',
        },
      ]);

      await component.chooseFile();

      expect(component.selectedFiles().map(({ path }) => path)).toEqual([
        'C:\\Docs\\existing.pdf',
      ]);
      expect(component.filePickerError()).toBeFalse();
    });

    it('shows an error and keeps the dialog open if the picker fails', async () => {
      const bridge = mockFilePicker(undefined);
      bridge.and.rejectWith(new Error('Picker failed'));
      setup(undefined, { isElectron: true });

      await component.chooseFile();

      expect(component.filePickerError()).toBeTrue();
      expect(dialogRef.close).not.toHaveBeenCalled();
    });
  });

  describe('submit() URL scheme prepending', () => {
    it('prepends http:// for a bare hostname (www.google.com)', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = 'www.google.com';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'http://www.google.com' }),
      );
    });

    it('prepends http:// for a bare domain (example.com)', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = 'example.com';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'http://example.com' }),
      );
    });

    it('does not prepend when an https:// scheme is present', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = 'https://example.com';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'https://example.com' }),
      );
    });

    it('does not prepend when a custom scheme (mailto:) is present', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = 'mailto:foo@example.com';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'mailto:foo@example.com' }),
      );
    });

    it('prepends http:// for a bare hostname when type is IMG', () => {
      setup();
      component.attachmentCopy.type = 'IMG';
      component.attachmentCopy.path = 'cdn.example.com/img.png';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'http://cdn.example.com/img.png' }),
      );
    });

    it('leaves FILE paths untouched', () => {
      setup();
      component.attachmentCopy.type = 'FILE';
      component.attachmentCopy.path = '/home/user/file.pdf';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: '/home/user/file.pdf' }),
      );
    });

    it('does not submit when path is empty', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = '';

      component.submit();

      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('trims surrounding whitespace before evaluating the scheme', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = '  https://example.com  ';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'https://example.com' }),
      );
    });

    it('does not submit when path is whitespace only', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = '   ';

      component.submit();

      expect(dialogRef.close).not.toHaveBeenCalled();
    });

    it('does not prepend for uppercase scheme (HTTPS://)', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = 'HTTPS://example.com';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'HTTPS://example.com' }),
      );
    });

    it('handles protocol-relative URLs without producing http:////', () => {
      setup();
      component.attachmentCopy.type = 'LINK';
      component.attachmentCopy.path = '//cdn.example.com/img.png';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'http://cdn.example.com/img.png' }),
      );
    });

    it('leaves data: URLs untouched for IMG type', () => {
      setup();
      component.attachmentCopy.type = 'IMG';
      component.attachmentCopy.path = 'data:image/png;base64,iVBORw0KGgo=';

      component.submit();

      expect(dialogRef.close).toHaveBeenCalledWith(
        jasmine.objectContaining({ path: 'data:image/png;base64,iVBORw0KGgo=' }),
      );
    });
  });
});
