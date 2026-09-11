import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MarkdownModule } from 'ngx-markdown';
import { EMPTY, of } from 'rxjs';
import { ClipboardImageService } from '../../../core/clipboard-image/clipboard-image.service';
import { ClipboardPasteHandlerService } from '../../../core/clipboard-image/clipboard-paste-handler.service';
import { SS } from '../../../core/persistence/storage-keys.const';
import { SnackService } from '../../../core/snack/snack.service';
import { TaskAttachmentService } from '../../tasks/task-attachment/task-attachment.service';
import { NoteService } from '../note.service';
import { DialogAddNoteComponent } from './dialog-add-note.component';

describe('DialogAddNoteComponent', () => {
  let component: DialogAddNoteComponent;
  let fixture: ComponentFixture<DialogAddNoteComponent>;
  let mockNoteService: jasmine.SpyObj<NoteService>;
  let mockDialogRef: { close: jasmine.Spy };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(DialogAddNoteComponent);
    component = fixture.componentInstance;
  };

  beforeEach(async () => {
    sessionStorage.removeItem(SS.NOTE_TMP);
    mockNoteService = jasmine.createSpyObj('NoteService', ['add']);
    mockDialogRef = {
      close: jasmine.createSpy('close'),
    };
    const mockClipboardImageService = jasmine.createSpyObj('ClipboardImageService', [
      'resolveMarkdownImages',
    ]);
    mockClipboardImageService.resolveMarkdownImages.and.callFake((content: string) =>
      Promise.resolve(content),
    );

    await TestBed.configureTestingModule({
      imports: [
        DialogAddNoteComponent,
        MarkdownModule.forRoot(),
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: {
            close: mockDialogRef.close,
            disableClose: false,
            keydownEvents: () => EMPTY,
          },
        },
        { provide: MAT_DIALOG_DATA, useValue: null },
        { provide: ClipboardImageService, useValue: mockClipboardImageService },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: ClipboardPasteHandlerService, useValue: {} },
        { provide: NoteService, useValue: mockNoteService },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    sessionStorage.removeItem(SS.NOTE_TMP);
  });

  it('should ask for confirmation when discarding recovered content and clear it when confirmed', () => {
    sessionStorage.setItem(SS.NOTE_TMP, 'recovered note');
    createComponent();
    const confirmDialogSpy = spyOn(component['_matDialog'], 'open').and.returnValue({
      afterClosed: () => of(true),
    } as any);

    component.close(true);

    // Recovered content counts as modified (a new note's original is empty).
    expect(confirmDialogSpy).toHaveBeenCalled();
    expect(sessionStorage.getItem(SS.NOTE_TMP)).toBeNull();
    expect(mockDialogRef.close).toHaveBeenCalled();
  });

  it('should keep the recovered content and stay open when discarding is cancelled', () => {
    sessionStorage.setItem(SS.NOTE_TMP, 'recovered note');
    createComponent();
    spyOn(component['_matDialog'], 'open').and.returnValue({
      afterClosed: () => of(false),
    } as any);

    component.close(true);

    expect(sessionStorage.getItem(SS.NOTE_TMP)).toBe('recovered note');
    expect(mockDialogRef.close).not.toHaveBeenCalled();
  });

  it('should add the note and clear the storage on save', () => {
    createComponent();
    component.data.content = 'new note content';
    component.ngModelChange('new note content');
    expect(sessionStorage.getItem(SS.NOTE_TMP)).toBe('new note content');

    component.close();

    expect(mockNoteService.add).toHaveBeenCalledWith(
      { content: 'new note content' },
      true,
    );
    expect(sessionStorage.getItem(SS.NOTE_TMP)).toBeNull();
    expect(mockDialogRef.close).toHaveBeenCalled();
  });
});
