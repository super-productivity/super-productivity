import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { DialogEditTaskAttachmentComponent } from './dialog-edit-task-attachment.component';
import { TaskAttachment } from '../task-attachment.model';
import { provideMockStore } from '@ngrx/store/testing';
import { selectTaskEntities } from '../../store/task.selectors';
import { Task } from '../../task.model';

describe('DialogEditTaskAttachmentComponent', () => {
  let component: DialogEditTaskAttachmentComponent;
  let fixture: ComponentFixture<DialogEditTaskAttachmentComponent>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<DialogEditTaskAttachmentComponent>>;

  const TASK_ENTITIES = {
    repeating: { id: 'repeating', repeatCfgId: 'cfg1' } as Task,
    regular: { id: 'regular' } as Task,
  };

  const setup = (attachment?: Partial<TaskAttachment>, taskId?: string): void => {
    dialogRef = jasmine.createSpyObj('MatDialogRef', ['close']);

    TestBed.configureTestingModule({
      imports: [DialogEditTaskAttachmentComponent, TranslateModule.forRoot()],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { attachment: attachment ?? {}, taskId },
        },
        provideMockStore({
          selectors: [{ selector: selectTaskEntities, value: TASK_ENTITIES }],
        }),
      ],
    });

    fixture = TestBed.createComponent(DialogEditTaskAttachmentComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  describe('repeat instance hint', () => {
    const hintEl = (): HTMLElement | null =>
      fixture.nativeElement.querySelector('.callout');

    it('shows when adding to an instance of a repeating task', () => {
      setup(undefined, 'repeating');

      expect(component.isShowRepeatInstanceHint()).toBe(true);
      expect(hintEl()?.textContent).toContain(
        'F.ATTACHMENT.DIALOG_EDIT.REPEAT_INSTANCE_HINT',
      );
    });

    it('shows for a dropped attachment, which arrives pre-filled but without id', () => {
      setup({ path: 'https://example.com', type: 'LINK' }, 'repeating');

      expect(component.isShowRepeatInstanceHint()).toBe(true);
    });

    it('hides when adding to a task that does not repeat', () => {
      setup(undefined, 'regular');

      expect(component.isShowRepeatInstanceHint()).toBe(false);
      expect(hintEl()).toBeNull();
    });

    it('hides when editing an existing attachment of a repeating task', () => {
      setup({ id: 'a1', path: 'https://example.com', type: 'LINK' }, 'repeating');

      expect(component.isShowRepeatInstanceHint()).toBe(false);
      expect(hintEl()).toBeNull();
    });

    it('hides when no task id is passed', () => {
      setup();

      expect(component.isShowRepeatInstanceHint()).toBe(false);
      expect(hintEl()).toBeNull();
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
