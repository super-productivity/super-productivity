import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogEditTaskAttachmentComponent } from './dialog-edit-task-attachment.component';
import { TaskAttachment } from '../task-attachment.model';

describe('DialogEditTaskAttachmentComponent', () => {
  let component: DialogEditTaskAttachmentComponent;
  let fixture: ComponentFixture<DialogEditTaskAttachmentComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogEditTaskAttachmentComponent>>;

  const setup = (attachment?: Partial<TaskAttachment>): void => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [DialogEditTaskAttachmentComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: { attachment: attachment ?? {} } },
      ],
    });

    fixture = TestBed.createComponent(DialogEditTaskAttachmentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

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
