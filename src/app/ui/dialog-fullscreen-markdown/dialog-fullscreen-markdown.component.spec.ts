import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { MarkdownModule } from 'ngx-markdown';
import { EMPTY } from 'rxjs';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { ClipboardPasteHandlerService } from '../../core/clipboard-image/clipboard-paste-handler.service';
import { TaskAttachmentService } from '../../features/tasks/task-attachment/task-attachment.service';
import { DialogFullscreenMarkdownComponent } from './dialog-fullscreen-markdown.component';

describe('DialogFullscreenMarkdownComponent', () => {
  let component: DialogFullscreenMarkdownComponent;
  let fixture: ComponentFixture<DialogFullscreenMarkdownComponent>;
  let dialogData: { content: string; taskId?: string };
  let mockClipboardImageService: jasmine.SpyObj<ClipboardImageService>;

  beforeEach(async () => {
    dialogData = {
      content: '- [ ] Task 1\n\n- [ ] Task 2',
    };
    mockClipboardImageService = jasmine.createSpyObj('ClipboardImageService', [
      'resolveMarkdownImages',
    ]);
    mockClipboardImageService.resolveMarkdownImages.and.callFake((content: string) =>
      Promise.resolve(content),
    );

    await TestBed.configureTestingModule({
      imports: [
        DialogFullscreenMarkdownComponent,
        MarkdownModule.forRoot(),
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: {
            close: jasmine.createSpy('close'),
            disableClose: false,
            keydownEvents: () => EMPTY,
          },
        },
        { provide: MAT_DIALOG_DATA, useValue: dialogData },
        { provide: ClipboardImageService, useValue: mockClipboardImageService },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: ClipboardPasteHandlerService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DialogFullscreenMarkdownComponent);
    component = fixture.componentInstance;
  });

  describe('clickPreview', () => {
    let mockPreviewEl: { element: { nativeElement: HTMLElement } };

    beforeEach(() => {
      mockPreviewEl = {
        element: {
          nativeElement: document.createElement('div'),
        },
      };
      spyOn(component, 'previewEl').and.returnValue(mockPreviewEl as any);
      spyOn(component.contentChanged, 'emit');
    });

    it('should toggle a gapped checklist item when clicking its label text', fakeAsync(() => {
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper undone';
      wrapper1.appendChild(document.createElement('span')).className =
        'checkbox material-icons';
      wrapper1.appendChild(document.createTextNode('Task 1'));

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper undone';
      const checkbox2 = document.createElement('span');
      checkbox2.className = 'checkbox material-icons';
      const label2 = document.createElement('span');
      label2.textContent = 'Task 2';
      wrapper2.appendChild(checkbox2);
      wrapper2.appendChild(label2);

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      component.clickPreview({ target: label2 } as unknown as MouseEvent);
      tick(500);

      expect(component.data.content).toBe('- [ ] Task 1\n\n- [x] Task 2');
      expect(component.contentChanged.emit).toHaveBeenCalledWith(
        '- [ ] Task 1\n\n- [x] Task 2',
      );
    }));

    it('should keep link clicks from toggling the parent checklist item', () => {
      const wrapper = document.createElement('li');
      wrapper.className = 'checkbox-wrapper undone';
      const link = document.createElement('a');
      link.href = 'https://example.com';
      link.textContent = 'link';
      wrapper.appendChild(document.createElement('span')).className =
        'checkbox material-icons';
      wrapper.appendChild(link);
      mockPreviewEl.element.nativeElement.appendChild(wrapper);

      component.clickPreview({ target: link } as unknown as MouseEvent);

      expect(component.data.content).toBe('- [ ] Task 1\n\n- [ ] Task 2');
      expect(component.contentChanged.emit).not.toHaveBeenCalled();
    });
  });
});
