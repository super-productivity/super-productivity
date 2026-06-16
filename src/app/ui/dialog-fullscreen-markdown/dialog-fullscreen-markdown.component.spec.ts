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
import { MOD, shortcutLabels } from './markdown-shortcuts.const';

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

  describe('keydownHandler', () => {
    let mockTextarea: HTMLTextAreaElement;

    beforeEach(() => {
      mockTextarea = document.createElement('textarea');
      spyOn(component, 'textareaEl').and.returnValue({
        nativeElement: mockTextarea,
      } as any);
    });

    it('should call close() on Ctrl+Enter', () => {
      spyOn(component, 'close');
      component.keydownHandler(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }),
      );
      expect(component.close).toHaveBeenCalled();
    });

    it('should call onApplyBold and preventDefault on Ctrl+B', () => {
      spyOn(component, 'onApplyBold');
      const event = {
        key: 'b',
        code: 'KeyB',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyBold).toHaveBeenCalled();
    });

    it('should call onApplyBold on Meta+B (Mac)', () => {
      spyOn(component, 'onApplyBold');
      const event = {
        key: 'b',
        code: 'KeyB',
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyBold).toHaveBeenCalled();
    });

    it('should call onApplyItalic on Ctrl+I', () => {
      spyOn(component, 'onApplyItalic');
      const event = {
        key: 'i',
        code: 'KeyI',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyItalic).toHaveBeenCalled();
    });

    it('should call onInsertLink on Ctrl+K', () => {
      spyOn(component, 'onInsertLink');
      const event = {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onInsertLink).toHaveBeenCalled();
    });

    it('should call onApplyStrikethrough on Ctrl+Shift+S', () => {
      spyOn(component, 'onApplyStrikethrough');
      const event = {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyStrikethrough).toHaveBeenCalled();
    });

    it('should call onApplyInlineCode on Ctrl+E', () => {
      spyOn(component, 'onApplyInlineCode');
      const event = {
        key: 'e',
        code: 'KeyE',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyInlineCode).toHaveBeenCalled();
    });

    it('should call onApplyBulletList on Ctrl+Shift+8 (code-based)', () => {
      spyOn(component, 'onApplyBulletList');
      const event = {
        key: '*',
        code: 'Digit8',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyBulletList).toHaveBeenCalled();
    });

    it('should call onApplyNumberedList on Ctrl+Shift+7 (code-based)', () => {
      spyOn(component, 'onApplyNumberedList');
      const event = {
        key: '&',
        code: 'Digit7',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyNumberedList).toHaveBeenCalled();
    });

    it('should call onApplyQuote on Ctrl+Shift+9 (code-based)', () => {
      spyOn(component, 'onApplyQuote');
      const event = {
        key: '(',
        code: 'Digit9',
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(component.onApplyQuote).toHaveBeenCalled();
    });

    it('should not trigger any shortcut when no modifier key is held', () => {
      spyOn(component, 'onApplyBold');
      const event = {
        key: 'b',
        code: 'KeyB',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(component.onApplyBold).not.toHaveBeenCalled();
    });

    it('should NOT trigger strikethrough on Ctrl+S without Shift', () => {
      spyOn(component, 'onApplyStrikethrough');
      const event = {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(component.onApplyStrikethrough).not.toHaveBeenCalled();
    });

    it('should NOT trigger bold on Ctrl+Alt+B', () => {
      spyOn(component, 'onApplyBold');
      const event = {
        key: 'b',
        code: 'KeyB',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as KeyboardEvent;

      component.keydownHandler(event);

      expect(component.onApplyBold).not.toHaveBeenCalled();
    });
  });

  describe('shortcutLabels', () => {
    it('should format bold label correctly', () => {
      expect(shortcutLabels.bold.tooltip).toBe(` (${MOD}+B)`);
      expect(shortcutLabels.bold.keys).toEqual([MOD, 'B']);
    });

    it('should include Shift for shift-based shortcuts', () => {
      expect(shortcutLabels.strikethrough.tooltip).toBe(` (${MOD}+Shift+S)`);
      expect(shortcutLabels.strikethrough.keys).toEqual([MOD, 'Shift', 'S']);
    });

    it('should use digit number for code-based shortcuts', () => {
      expect(shortcutLabels.bullet.tooltip).toBe(` (${MOD}+Shift+8)`);
      expect(shortcutLabels.bullet.keys).toEqual([MOD, 'Shift', '8']);
    });
  });
});
