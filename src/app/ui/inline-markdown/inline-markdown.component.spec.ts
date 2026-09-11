import {
  ComponentFixture,
  DeferBlockState,
  fakeAsync,
  TestBed,
  tick,
} from '@angular/core/testing';
import { MatDialog, MatDialogState } from '@angular/material/dialog';
import { MarkdownModule } from 'ngx-markdown';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { InlineMarkdownComponent } from './inline-markdown.component';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, Subject } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { Log } from '../../core/log';
import { Location } from '@angular/common';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';

describe('InlineMarkdownComponent', () => {
  let component: InlineMarkdownComponent;
  let fixture: ComponentFixture<InlineMarkdownComponent>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockClipboardImageService: jasmine.SpyObj<ClipboardImageService>;
  /**
   * Markdown formatting now decides which editor mounts: on → the live markdown
   * editor (#9910), off → a plain textarea. Most specs here drive the component
   * API directly and do not care; the ones that reach into the rendered DOM set
   * this before the first `detectChanges`, since the config spy is a plain
   * function and the `computed` over it caches on first read.
   */
  let isMarkdownFormattingOn: boolean;

  beforeEach(async () => {
    isMarkdownFormattingOn = true;
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      tasks: jasmine.createSpy().and.callFake(() => ({
        isTurnOffMarkdown: false,
        isMarkdownFormattingInNotesEnabled: isMarkdownFormattingOn,
      })),
      misc: jasmine.createSpy().and.returnValue({}),
    });
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockClipboardImageService = jasmine.createSpyObj('ClipboardImageService', [
      'resolveMarkdownImages',
      'hasResolvableImages',
    ]);
    mockClipboardImageService.resolveMarkdownImages.and.callFake((content: string) =>
      Promise.resolve(content),
    );
    // Default: notes have no clipboard images, so they render synchronously.
    mockClipboardImageService.hasResolvableImages.and.callFake((content: string) =>
      content.includes('indexeddb://clipboard-images/'),
    );

    await TestBed.configureTestingModule({
      imports: [
        InlineMarkdownComponent,
        MarkdownModule.forRoot(),
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: ClipboardImageService, useValue: mockClipboardImageService },
        provideMockStore(),
        provideMockActions(() => of()),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InlineMarkdownComponent);
    component = fixture.componentInstance;
  });

  /**
   * The shipped path: markdown formatting is on by default, so the live editor
   * is what real users get. It sits behind `@defer (on immediate)`, which never
   * renders on its own in TestBed — each spec renders the block explicitly.
   */
  describe('live markdown editor', () => {
    const editorView = (): EditorView =>
      EditorView.findFromDOM(fixture.nativeElement.querySelector('.cm-content'))!;

    const mountLiveEditor = async (model: string): Promise<void> => {
      component.model = model;
      fixture.detectChanges();
      const [deferBlock] = await fixture
        .whenStable()
        .then(() => fixture.getDeferBlocks());
      await deferBlock.render(DeferBlockState.Complete);
    };

    it('mounts the live editor instead of the textarea', async () => {
      await mountLiveEditor('# A heading');

      expect(component.liveEditorEl()).toBeTruthy();
      expect(component.textareaEl()).toBeUndefined();
      // The document keeps the raw markdown; only the view hides the marker.
      expect(component.liveEditorEl()!.value).toBe('# A heading');
      expect(
        fixture.nativeElement.querySelector('.cm-content').textContent,
      ).not.toContain('#');
    });

    for (const nextNotes of ['Task B notes', 'Task A notes, edited']) {
      it(`isolates undo when switching tasks to ${nextNotes}`, async () => {
        fixture.componentRef.setInput('taskId', 'task-a');
        await mountLiveEditor('Task A notes');
        const view = editorView();
        view.dispatch({ changes: { from: view.state.doc.length, insert: ', edited' } });
        component.onLiveEditorChanged(view.state.doc.toString());
        fixture.detectChanges();

        fixture.componentRef.setInput('taskId', 'task-b');
        component.model = nextNotes;
        fixture.detectChanges();
        await fixture.whenStable();

        expect(undo(editorView())).toBe(false);
        expect(editorView().state.doc.toString()).toBe(nextNotes);
      });
    }

    it('preserves undo after saving an edit on the same task', async () => {
      fixture.componentRef.setInput('taskId', 'task-a');
      await mountLiveEditor('Original notes');
      const view = editorView();
      view.dispatch({ changes: { from: view.state.doc.length, insert: ', edited' } });
      component.onLiveEditorChanged(view.state.doc.toString());
      fixture.detectChanges();
      await fixture.whenStable();

      expect(undo(editorView())).toBe(true);
      expect(editorView().state.doc.toString()).toBe('Original notes');
    });

    it('places typing after the first checklist marker', async () => {
      fixture.componentRef.setInput('isDefaultText', true);
      fixture.componentRef.setInput('defaultText', 'Default notes');
      fixture.componentRef.setInput('isShowChecklistToggle', true);
      await mountLiveEditor('Default notes');

      component.toggleChecklistMode(new Event('click'));
      fixture.detectChanges();
      // Selection restoration follows the model update on the next timer turn;
      // zoneless whenStable() does not wait for that timer.
      await new Promise<void>((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      const view = editorView();
      view.dispatch(view.state.replaceSelection('milk'));

      expect(view.state.doc.toString()).toBe('- [ ] milk');
    });

    // Typing must not save: a note is one op per edit session, not per keystroke.
    it("does not commit while typing, and commits on the editor's own change", async () => {
      await mountLiveEditor('before');
      spyOn(component.changed, 'emit');

      component.onLiveEditorDocChanged('while typing');
      expect(component.changed.emit).not.toHaveBeenCalled();

      component.onLiveEditorChanged('committed');
      expect(component.changed.emit).toHaveBeenCalledWith('committed');
    });

    // Closing the detail panel destroys this component on mousedown and the
    // editor's blur lands afterwards, where the emit is dropped — so the last
    // typed document has to be committed from ngOnDestroy.
    it('commits the last typed document on destroy', async () => {
      await mountLiveEditor('before');
      spyOn(component.changed, 'emit');

      component.onLiveEditorDocChanged('typed but never blurred');
      component.ngOnDestroy();

      expect(component.changed.emit).toHaveBeenCalledWith('typed but never blurred');
    });

    // ...but only for the task it was typed into. Switching tasks re-uses this
    // component instance, and a stale doc would be written onto the next task.
    it('drops the typed document when the model switches to another note', async () => {
      await mountLiveEditor('task A notes');
      component.onLiveEditorDocChanged('task A notes, edited');
      spyOn(component.changed, 'emit');

      component.model = 'task B notes';
      component.ngOnDestroy();

      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    // The checklist toolbar is the one control editing the document from
    // outside the editor: it has to see a checklist while it is still being
    // typed, not only after the blur that commits it.
    it('offers the checklist actions for a checklist that is still being typed', async () => {
      fixture.componentRef.setInput('isShowChecklistToggle', true);
      await mountLiveEditor('not a checklist yet');
      expect(component.isCurrentlyChecklist()).toBe(false);

      component.onLiveEditorDocChanged('- [ ] one');

      expect(component.isCurrentlyChecklist()).toBe(true);
    });

    // The transforms read the mounted editor, not the last committed copy.
    it("applies a checklist transform to the editor's current document", async () => {
      await mountLiveEditor('- [ ] one\n- [ ] two');
      spyOn(component.changed, 'emit');

      component.checkAllChecklistItems();

      expect(component.changed.emit).toHaveBeenCalledWith('- [x] one\n- [x] two');
    });
  });

  describe('keypressHandler', () => {
    // The plain-text editor: reachable when markdown formatting is off.
    beforeEach(() => {
      isMarkdownFormattingOn = false;
    });

    let mockTextareaEl: {
      nativeElement: {
        selectionEnd: number;
        selectionStart: number;
        setSelectionRange: jasmine.Spy;
        value: string;
      };
    };
    beforeEach(() => {
      component.model = 'Hello world';
      fixture.detectChanges();
      component['isShowEdit'].set(true);
      mockTextareaEl = {
        nativeElement: {
          selectionStart: 0,
          selectionEnd: 0,
          setSelectionRange: jasmine.createSpy('setSelectionRange'),
          value: 'Hello world',
        },
      };
      spyOn(component, 'resizeTextareaToFit'); // skip resize logic
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl as any);
      spyOn(component.changed, 'emit');
    });

    it('should wrap selected text with ** on Ctrl+B', () => {
      mockTextareaEl.nativeElement.selectionStart = 6;
      mockTextareaEl.nativeElement.selectionEnd = 11;
      const ev = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true });
      component.keypressHandler(ev);
      expect(mockTextareaEl.nativeElement.value).toBe('Hello **world**');
      expect(component.changed.emit).toHaveBeenCalledWith('Hello **world**');
    });

    it('should wrap selected text with _ on Ctrl + I', () => {
      mockTextareaEl.nativeElement.selectionStart = 6;
      mockTextareaEl.nativeElement.selectionEnd = 11;
      const ev = new KeyboardEvent('keydown', { key: 'i', ctrlKey: true });
      component.keypressHandler(ev);
      expect(mockTextareaEl.nativeElement.value).toBe('Hello _world_');
      expect(component.changed.emit).toHaveBeenCalledWith('Hello _world_');
    });

    it('should insert ** at cursor and place cursor between pairs of ** when pressing Ctrl + B with no selection', () => {
      mockTextareaEl.nativeElement.selectionStart = 5;
      mockTextareaEl.nativeElement.selectionEnd = 5;
      const ev = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true });
      component.keypressHandler(ev);
      expect(mockTextareaEl.nativeElement.value).toBe('Hello**** world');
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(7, 7);
    });

    it('should insert _ at cursor and place cursor between pairs of _ when pressing Ctrl + I with no selection', () => {
      mockTextareaEl.nativeElement.selectionStart = 5;
      mockTextareaEl.nativeElement.selectionEnd = 5;
      const ev = new KeyboardEvent('keydown', { key: 'i', ctrlKey: true });
      component.keypressHandler(ev);
      expect(mockTextareaEl.nativeElement.value).toBe('Hello__ world');
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(6, 6);
    });
  });

  describe('long note wrapping', () => {
    it('should wrap long words in the plain-text editor', fakeAsync(() => {
      isMarkdownFormattingOn = false;
      const longToken = 'AVeryLongUnbrokenWordThatShouldWrapInsideTheEditor';
      component.model = `[${longToken}](https://example.com/${longToken})`;
      component['isShowEdit'].set(true);
      fixture.detectChanges();
      tick();

      const textarea = fixture.nativeElement.querySelector(
        'textarea.markdown-unparsed',
      ) as HTMLTextAreaElement;

      expect(window.getComputedStyle(textarea).overflowWrap).toBe('anywhere');
      expect(window.getComputedStyle(textarea).whiteSpace).toBe('pre-wrap');
    }));
  });

  // The rendered-preview assertions that lived here (checkbox glyph
  // selectability, XSS sanitization, isHidePreviewWhileEditing, clickPreview,
  // _handleCheckboxClick) went with the preview itself: this component mounts
  // the live markdown editor whenever markdown is parsed at all, and a plain
  // textarea otherwise, so there was no configuration left that rendered one.
  // The contracts they covered live on: sanitization end-to-end against the
  // real marked + DomSanitizer pipeline in `src/app/ui/markdown-sanitization.spec.ts`
  // (GHSA-4rrp-xhp8-hf4p), and checkbox toggling in
  // `src/app/features/markdown-checklist/checklist-operations.spec.ts`.

  describe('ngOnDestroy', () => {
    // The plain-text editor: reachable when markdown formatting is off.
    beforeEach(() => {
      isMarkdownFormattingOn = false;
    });

    it('should emit changed event with current value when in edit mode and value has changed', () => {
      // Arrange
      const originalValue = 'original text';
      const changedValue = 'changed text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with changed value
      const mockTextareaEl = {
        nativeElement: { value: changedValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(changedValue);
    });

    it('should not emit changed event when in edit mode but value has not changed', () => {
      // Arrange
      const originalValue = 'original text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with unchanged value
      const mockTextareaEl = {
        nativeElement: { value: originalValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit changed event when not in edit mode', () => {
      // Arrange
      const originalValue = 'original text';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      // Ensure we're not in edit mode
      component['isShowEdit'].set(false);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit changed event when textarea element is not available', () => {
      // Arrange
      spyOn(component.changed, 'emit');

      component.model = 'some text';
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element as undefined
      spyOn(component, 'textareaEl').and.returnValue(undefined);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should clear timeout and still emit changed event if needed', () => {
      // Arrange
      const originalValue = 'original text';
      const changedValue = 'changed text';
      spyOn(component.changed, 'emit');
      spyOn(window, 'clearTimeout');

      // Set up a timeout to be cleared
      component['_hideOverFlowTimeout'] = window.setTimeout(() => {}, 1000);

      component.model = originalValue;
      fixture.detectChanges();

      // Simulate entering edit mode
      component['isShowEdit'].set(true);

      // Mock textarea element with changed value
      const mockTextareaEl = {
        nativeElement: { value: changedValue },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl);

      // Act
      component.ngOnDestroy();

      // Assert
      expect(window.clearTimeout).toHaveBeenCalled();
      expect(component.changed.emit).toHaveBeenCalledWith(changedValue);
    });
  });

  describe('toggleChecklistMode', () => {
    // The plain-text editor: reachable when markdown formatting is off.
    beforeEach(() => {
      isMarkdownFormattingOn = false;
    });

    const setupMockTextarea = (
      text: string,
      selectionStart = 0,
      selectionEnd: number = selectionStart,
    ): any => {
      component.model = text;
      fixture.detectChanges();
      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart,
          selectionEnd,
          focus: jasmine.createSpy('focus'),
          setSelectionRange: jasmine.createSpy('setSelectionRange'),
          style: {},
          scrollHeight: 100,
          offsetHeight: 100,
        },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl as any);
      spyOn(component, 'wrapperEl').and.returnValue({
        nativeElement: { style: {} },
      } as any);

      return mockTextareaEl;
    };

    it('should preserve unsaved textarea content when adding checklist item while focused', () => {
      // Arrange
      const originalValue = 'original text';
      const unsavedValue = 'unsaved typed content';
      spyOn(component.changed, 'emit');

      const mockTextareaEl = setupMockTextarea(originalValue, unsavedValue.length);
      mockTextareaEl.nativeElement.value = unsavedValue;

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — emits the FINAL value (with new checklist item), not the pre-insertion value
      expect(component.changed.emit).toHaveBeenCalledWith(
        'unsaved typed content\n- [ ] ',
      );
      expect(component.modelCopy()).toContain(unsavedValue);
      expect(component.modelCopy()).toContain('- [ ] ');
    });

    it('should emit final value even when textarea value matches model', () => {
      // Arrange
      const value = 'same text';
      spyOn(component.changed, 'emit');
      setupMockTextarea(value, value.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — always emits the final value with the new checklist item
      expect(component.changed.emit).toHaveBeenCalledWith('same text\n- [ ] ');
    });

    it('should work from preview mode when textarea is not visible', () => {
      // Arrange
      const value = 'some text';
      spyOn(component.changed, 'emit');

      component.model = value;
      fixture.detectChanges();

      component['isShowEdit'].set(false);

      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — emits the final value with new checklist item in all paths
      expect(component.changed.emit).toHaveBeenCalledWith('some text\n- [ ] ');
      expect(component['_toggleShowEdit']).toHaveBeenCalled();
    });

    it('should create first checklist item when isDefaultText', () => {
      // Arrange
      spyOn(component.changed, 'emit');

      component.model = '';
      fixture.detectChanges();

      component['isShowEdit'].set(false);

      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn(component, 'isDefaultText').and.returnValue(true);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.modelCopy()).toBe('- [ ] ');
      expect(component.changed.emit).toHaveBeenCalledOnceWith('- [ ] ');
    });

    it('should preserve default template content when toggling checklist (issue #7786)', () => {
      // Arrange — task has no saved notes but a default template is visible
      spyOn(component.changed, 'emit');
      const defaultTemplate = '**How can I best achieve it now?**';
      component.model = defaultTemplate;
      fixture.detectChanges();

      component['isShowEdit'].set(false);
      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn(component, 'isDefaultText').and.returnValue(true);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — visible template preserved, checkbox appended below
      const finalText = component.modelCopy();
      expect(finalText).toContain(defaultTemplate);
      expect(finalText).toContain('- [ ] ');
      expect(component.changed.emit).toHaveBeenCalledTimes(1);
    });

    it('should replace the unmodified default template with a fresh checklist', () => {
      // Arrange — only the (replaceable) default template is shown, untouched
      spyOn(component.changed, 'emit');
      const template = '**How can I best achieve it now?**';
      component.model = template;
      fixture.detectChanges();

      component['isShowEdit'].set(false);
      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn(component, 'isDefaultText').and.returnValue(true);
      spyOn(component, 'defaultText').and.returnValue(template);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — template replaced, not appended to
      expect(component.modelCopy()).toBe('- [ ] ');
      expect(component.changed.emit).toHaveBeenCalledOnceWith('- [ ] ');
    });

    it('should append (not replace) once the default template has been edited', () => {
      // Arrange — default text is replaceable, but the user already typed into it
      spyOn(component.changed, 'emit');
      const template = '**How can I best achieve it now?**';
      component.model = template + ' typed';
      fixture.detectChanges();

      component['isShowEdit'].set(false);
      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn(component, 'isDefaultText').and.returnValue(true);
      spyOn(component, 'defaultText').and.returnValue(template);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — edited content preserved, checkbox appended below
      expect(component.modelCopy()).toBe(template + ' typed\n- [ ] ');
    });

    it('should insert checklist item after cursor line, not at end', () => {
      // Arrange
      const text = '- [ ] First\n- [ ] Second\n- [ ] Third';
      setupMockTextarea(text, 5);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — inserted after "First" line, not appended to end
      expect(component.modelCopy()).toBe(
        '- [ ] First\n- [ ] \n- [ ] Second\n- [ ] Third',
      );
    });

    it('should insert between grouped checklists without affecting other groups', () => {
      // Arrange
      const text = '## Group 1\n- [ ] A\n- [ ] B\n\n## Group 2\n- [ ] C';
      setupMockTextarea(text, 17);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — new item inserted after "A", Group 2 unchanged
      const result = component.modelCopy()!;
      expect(result).toContain('- [ ] A\n- [ ] \n- [ ] B');
      expect(result).toContain('## Group 2\n- [ ] C');
    });

    it('should insert after first line when cursor is at position 0', () => {
      // Arrange
      const text = '- [ ] Only item';
      setupMockTextarea(text, 0);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — inserts after the first (and only) line
      expect(component.modelCopy()).toBe('- [ ] Only item\n- [ ] ');
    });

    it('should append to end when cursor is at end of text', () => {
      // Arrange
      const text = '- [ ] First\n- [ ] Second';
      setupMockTextarea(text, text.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — appended to end (same as old behavior)
      expect(component.modelCopy()).toBe('- [ ] First\n- [ ] Second\n- [ ] ');
    });

    it('should adjust cursor position after double-newline cleanup', () => {
      // Arrange — text with double newline before a checklist item
      const text = '- [ ] A\n\n- [ ] B';
      setupMockTextarea(text, 16);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — double newlines cleaned up
      const result = component.modelCopy()!;
      expect(result).not.toContain('\n\n');
      expect(result).toContain('- [ ] A\n- [ ] B\n- [ ] ');
    });

    it('should insert at cursor even when blur fires between mousedown and click', () => {
      // Arrange: simulates blur firing between mousedown and click events,
      // where isShowEdit becomes false but the textarea is still in the DOM
      const text = '- [ ] asdasd\n\n# some text after';
      setupMockTextarea(text, 12);

      // isShowEdit was set to false by blur, but textarea still exists in DOM
      component['isShowEdit'].set(false);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — item inserted after "asdasd", not appended to end
      expect(component.modelCopy()).toBe('- [ ] asdasd\n- [ ] \n\n# some text after');
      // isShowEdit should be restored to true
      expect(component.isShowEdit()).toBe(true);
    });

    it('should append to end from preview mode', () => {
      // Arrange
      const text = 'Some existing text';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(false);

      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — appended to end
      expect(component.modelCopy()).toBe('Some existing text\n- [ ] ');
      expect(component['_toggleShowEdit']).toHaveBeenCalledWith(
        'Some existing text\n- [ ] '.length,
      );
    });

    it('should position cursor at end of inserted item via setSelectionRange', fakeAsync(() => {
      // Arrange
      const text = '- [ ] First\n- [ ] Second';
      const mockTextareaEl = setupMockTextarea(text, 5);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);
      tick();

      // Assert — cursor at end of inserted "- [ ] " (after "First\n- [ ] ")
      // "- [ ] First" (11) + "\n" (1) + "- [ ] " (6) = 18 chars
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(18, 18);
      expect(mockTextareaEl.nativeElement.focus).toHaveBeenCalled();
    }));

    it('should handle empty non-default text while editing', () => {
      // Arrange
      const text = '';
      setupMockTextarea(text, 0);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — leading newline cleaned, just "- [ ] "
      expect(component.modelCopy()).toBe('- [ ] ');
    });

    it('should handle isDefaultText while editing (textarea exists)', () => {
      // Arrange
      spyOn(component.changed, 'emit');
      setupMockTextarea('', 0);
      spyOn(component, 'isDefaultText').and.returnValue(true);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — replaces content with first checklist item
      expect(component.modelCopy()).toBe('- [ ] ');
      expect(component.isShowEdit()).toBe(true);
      expect(component.changed.emit).toHaveBeenCalledOnceWith('- [ ] ');
    });

    it('should insert at cursor on line with trailing newline', () => {
      // Arrange — text ends with a newline, cursor at the empty last line
      const text = '- [ ] Item\n';
      setupMockTextarea(text, 11);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — inserts after the empty line at end
      expect(component.modelCopy()).toBe('- [ ] Item\n- [ ] ');
    });

    it('should set isChecklistMode to true after insertion from textarea', () => {
      // Arrange
      const text = '- [ ] A\n- [ ] B';
      setupMockTextarea(text, text.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.isChecklistMode()).toBe(true);
    });

    it('should set isChecklistMode to true after insertion from preview mode', () => {
      // Arrange
      const text = '- [ ] A';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(false);

      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.isChecklistMode()).toBe(true);
    });

    it('should produce exact output when inserting after middle item of checklist', () => {
      // Arrange
      const text = '- [ ] A\n- [ ] B\n- [ ] C';
      setupMockTextarea(text, 15);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.modelCopy()).toBe('- [ ] A\n- [ ] B\n- [ ] \n- [ ] C');
    });

    it('should produce exact output when inserting into text with mixed content', () => {
      // Arrange
      const text = 'Some notes\n- [ ] Task';
      setupMockTextarea(text, text.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.modelCopy()).toBe('Some notes\n- [ ] Task\n- [ ] ');
    });

    it('should update model when textarea value differs from model', () => {
      // Arrange
      const mockTextareaEl = setupMockTextarea('old', 3);
      mockTextareaEl.nativeElement.value = 'new';

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — model reflects the final value (textarea content + checklist item)
      expect(component.model).toBe('new\n- [ ] ');
    });

    it('should not lose new checklist item when model setter is called after emit (Angular CD simulation)', () => {
      // Arrange
      const text = '- [ ] Existing';
      spyOn(component.changed, 'emit');
      setupMockTextarea(text, text.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act — call toggleChecklistMode
      component.toggleChecklistMode(mockEvent);

      // Simulate Angular CD: parent receives emitted value and calls model setter
      const emittedValue = (component.changed.emit as jasmine.Spy).calls.mostRecent()
        .args[0];
      component.model = emittedValue;

      // Assert — modelCopy should still contain the new checklist item
      expect(component.modelCopy()).toBe('- [ ] Existing\n- [ ] ');
    });

    it('should add exactly one checklist item on each repeated click', () => {
      // Arrange
      const initialText = '- [ ] Item 1';
      spyOn(component.changed, 'emit');
      const mockTextareaEl = setupMockTextarea(initialText, initialText.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Click 1
      component.toggleChecklistMode(mockEvent);
      const afterClick1 = component.modelCopy()!;
      // Simulate Angular CD
      const emitted1 = (component.changed.emit as jasmine.Spy).calls.mostRecent().args[0];
      component.model = emitted1;

      // Verify after click 1: should have exactly 2 checklist items
      const items1 = afterClick1.match(/- \[ \] /g) || [];
      expect(items1.length).toBe(2);

      // Click 2 — update textarea mock to reflect current state
      mockTextareaEl.nativeElement.value = component.modelCopy()!;
      mockTextareaEl.nativeElement.selectionStart = component.modelCopy()!.length;
      mockTextareaEl.nativeElement.selectionEnd = component.modelCopy()!.length;

      component.toggleChecklistMode(mockEvent);
      const afterClick2 = component.modelCopy()!;
      const emitted2 = (component.changed.emit as jasmine.Spy).calls.mostRecent().args[0];
      component.model = emitted2;

      // Verify after click 2: should have exactly 3 checklist items
      const items2 = afterClick2.match(/- \[ \] /g) || [];
      expect(items2.length).toBe(3);
    });

    it('should not lose new checklist item from preview mode after Angular CD', () => {
      // Arrange
      const text = '- [ ] Existing';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(false);
      spyOn(component.changed, 'emit');
      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Simulate Angular CD: parent receives emitted value and calls model setter
      const emittedValue = (component.changed.emit as jasmine.Spy).calls.mostRecent()
        .args[0];
      component.model = emittedValue;

      // Assert — modelCopy should still contain the new checklist item
      expect(component.modelCopy()).toBe('- [ ] Existing\n- [ ] ');
    });

    it('should emit changed exactly once from textarea path', () => {
      // Arrange
      const text = '- [ ] Item';
      spyOn(component.changed, 'emit');
      setupMockTextarea(text, text.length);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — emit called exactly once with the final value
      expect(component.changed.emit).toHaveBeenCalledOnceWith('- [ ] Item\n- [ ] ');
    });

    it('should emit changed exactly once from preview path', () => {
      // Arrange
      const text = '- [ ] Item';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(false);
      spyOn(component.changed, 'emit');
      spyOn(component, 'textareaEl').and.returnValue(undefined);
      spyOn<any>(component, '_toggleShowEdit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — emit called exactly once with the final value
      expect(component.changed.emit).toHaveBeenCalledOnceWith('- [ ] Item\n- [ ] ');
    });

    it('should insert between newline-separated items when cursor is on the newline', () => {
      // Arrange
      const text = '- [ ] A\n- [ ] B';
      setupMockTextarea(text, 7);

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — new item inserted between A and B
      expect(component.modelCopy()).toBe('- [ ] A\n- [ ] \n- [ ] B');
    });

    it('should insert empty checklist item after cursor line when selectionStart equals selectionEnd', fakeAsync(() => {
      // Arrange — collapsed cursor in the middle of a line
      const text = '- [ ] First\n- [ ] Second';
      const mockTextareaEl = setupMockTextarea(text, 5, 5);
      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);
      tick();

      // Assert — empty item inserted after "First" line, selection placed at end of inserted item
      expect(component.modelCopy()).toBe('- [ ] First\n- [ ] \n- [ ] Second');
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(18, 18);
    }));

    it('should convert selected text to checklist items and preserve selection range', fakeAsync(() => {
      // Arrange
      const text = 'Folge 1: 17. Dezember\nFolge 2: 24. Dezember\nFolge 3: 31. Dezember';
      const mockTextareaEl = setupMockTextarea(text, 0, text.length);
      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);
      tick();

      // Assert — selected text converted to checklist items and selection range preserved
      const expectedText =
        '- [ ] Folge 1: 17. Dezember\n- [ ] Folge 2: 24. Dezember\n- [ ] Folge 3: 31. Dezember';
      expect(component.modelCopy()).toBe(expectedText);
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(
        0,
        expectedText.length,
      );
    }));

    it('should convert partially selected text to checklist items and preserve selection range', fakeAsync(() => {
      // Arrange
      const text = 'Line 1\nLine 2\nLine 3\nLine 4';
      const mockTextareaEl = setupMockTextarea(text, 7, 20); // "Line 2\nLine 3"
      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);
      tick();

      // Assert — only selected lines converted and selection range covers converted block
      const expectedText = 'Line 1\n- [ ] Line 2\n- [ ] Line 3\nLine 4';
      expect(component.modelCopy()).toBe(expectedText);
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(7, 32);
    }));

    it('should toggle checklist prefix when selected text already has checklist items and preserve selection range', fakeAsync(() => {
      // Arrange
      const text = '- [ ] Item 1\n- [ ] Item 2\n- [ ] Item 3';
      const mockTextareaEl = setupMockTextarea(text, 0, text.length);
      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);
      tick();

      // Assert — checklist items toggled to plain bullets and selection preserved
      const expectedText = '- Item 1\n- Item 2\n- Item 3';
      expect(component.modelCopy()).toBe(expectedText);
      expect(component.isChecklistMode()).toBe(false);
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(
        0,
        expectedText.length,
      );
    }));

    it('should convert selected text when isDefaultText is true and textarea has non-empty text (issue #6015 regression)', fakeAsync(() => {
      // Arrange — task with no saved notes (isDefaultText = true), user pasted text in textarea without blurring
      const text = 'Pasted task 1\nPasted task 2';
      const mockTextareaEl = setupMockTextarea('', 0, text.length);
      mockTextareaEl.nativeElement.value = text;
      spyOn(component, 'isDefaultText').and.returnValue(true);
      spyOn(component, 'defaultText').and.returnValue('');
      spyOn(component.changed, 'emit');

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);
      tick();

      // Assert — converts the pasted selection rather than replacing everything with "- [ ] "
      const expectedText = '- [ ] Pasted task 1\n- [ ] Pasted task 2';
      expect(component.modelCopy()).toBe(expectedText);
      expect(component.changed.emit).toHaveBeenCalledWith(expectedText);
      expect(mockTextareaEl.nativeElement.setSelectionRange).toHaveBeenCalledWith(
        0,
        expectedText.length,
      );
    }));
  });

  describe('checklist actions', () => {
    beforeEach(() => {
      component.model = '- [ ] a\n- [x] b\n- [ ] c';
      fixture.detectChanges();
      spyOn(component.changed, 'emit');
    });

    it('checkAll should check every item and emit', () => {
      component.checkAllChecklistItems();
      expect(component.changed.emit).toHaveBeenCalledWith('- [x] a\n- [x] b\n- [x] c');
    });

    it('uncheckAll should uncheck every item and emit', () => {
      component.uncheckAllChecklistItems();
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] a\n- [ ] b\n- [ ] c');
    });

    it('clearCompleted should drop checked items and emit', () => {
      component.clearCompletedChecklistItems();
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] a\n- [ ] c');
    });

    it('should not emit when a bulk action is a no-op', () => {
      component.model = '- [ ] a\n- [ ] b';
      fixture.detectChanges();
      component.uncheckAllChecklistItems();
      expect(component.changed.emit).not.toHaveBeenCalled();
    });
  });

  describe('fullscreen editor save after the host is destroyed mid-edit', () => {
    let afterClosed$: Subject<unknown>;
    let store: MockStore;

    beforeEach(() => {
      afterClosed$ = new Subject<unknown>();
      mockMatDialog.open.and.returnValue({
        afterClosed: () => afterClosed$.asObservable(),
      } as any);
      store = TestBed.inject(MockStore);
      spyOn(store, 'dispatch');
      spyOn(component.changed, 'emit');
      fixture.componentRef.setInput('taskId', 'task-1');
      fixture.detectChanges();
    });

    // Regression: the fullscreen dialog is a detached overlay. When the focus
    // session ends mid-edit it destroys the component that opened the dialog, so
    // emitting `changed` on save would reach no listener and the note is lost.
    it('persists the note directly to the task when destroyed while the dialog is open', () => {
      component.openFullScreen();
      component.ngOnDestroy();

      afterClosed$.next('saved note');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { notes: 'saved note' } },
        }),
      );
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('emits via `changed` (no direct dispatch) when still alive', () => {
      component.openFullScreen();

      afterClosed$.next('saved note');

      expect(component.changed.emit).toHaveBeenCalledWith('saved note');
      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('persists a replacement of pre-existing notes when destroyed mid-edit', () => {
      component.model = 'original notes';
      fixture.detectChanges();
      component.openFullScreen();
      component.ngOnDestroy();

      afterClosed$.next('original notes plus more');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { notes: 'original notes plus more' } },
        }),
      );
    });

    it('clears the note (DELETE) directly when destroyed mid-edit', () => {
      component.model = 'some real notes';
      fixture.detectChanges();
      component.openFullScreen();
      component.ngOnDestroy();

      afterClosed$.next({ action: 'DELETE' });

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({ task: { id: 'task-1', changes: { notes: '' } } }),
      );
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('does nothing when the dialog is closed without a result (Close, not Save)', () => {
      component.openFullScreen();
      component.ngOnDestroy();

      afterClosed$.next(undefined);

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('does not persist when the content is unchanged (no default-text write-back)', () => {
      component.model = 'How can I best achieve it now?';
      fixture.detectChanges();
      component.openFullScreen();
      component.ngOnDestroy();

      afterClosed$.next('How can I best achieve it now?');

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only diff of the loaded text as unchanged', () => {
      component.model = 'How can I best achieve it now?';
      fixture.detectChanges();
      component.openFullScreen();
      component.ngOnDestroy();

      // The editor can re-emit the placeholder with a trailing newline; that is
      // not a real edit and must not be written back as a note.
      afterClosed$.next('How can I best achieve it now?\n');

      expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('warns rather than silently dropping when destroyed without a taskId', () => {
      const warnSpy = spyOn(Log, 'warn');
      fixture.componentRef.setInput('taskId', undefined);
      component.model = 'orig';
      fixture.detectChanges();
      component.openFullScreen();
      component.ngOnDestroy();

      afterClosed$.next('edited content');

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  // The navigation→save→close mechanics live in open-fullscreen-markdown-dialog
  // (and its own spec); here we assert the opener's end of the contract: a
  // navigation-close must PERSIST the edit, not just close it.
  describe('fullscreen editor persists the edit on a navigation-close (#8434)', () => {
    let afterClosed$: Subject<unknown>;
    let store: MockStore;
    let locationCb: ((value: PopStateEvent) => void) | undefined;

    beforeEach(() => {
      afterClosed$ = new Subject<unknown>();
      locationCb = undefined;

      // Capture the Location listener so a navigation can be simulated.
      const location = TestBed.inject(Location);
      spyOn(location, 'subscribe').and.callFake((cb: (value: PopStateEvent) => void) => {
        locationCb = cb;
        return { unsubscribe: () => {} } as never;
      });

      mockMatDialog.open.and.returnValue({
        afterClosed: () => afterClosed$.asObservable(),
        componentInstance: { close: () => {} },
        getState: () => MatDialogState.OPEN,
      } as never);
      store = TestBed.inject(MockStore);
      spyOn(store, 'dispatch');
      fixture.componentRef.setInput('taskId', 'task-1');
      fixture.detectChanges();
    });

    const navigate = (): void => locationCb!({} as PopStateEvent);

    // Guards against a future revert to a direct _matDialog.open (which would
    // reintroduce the data loss): the helper always disables closeOnNavigation.
    it('routes the fullscreen dialog through the nav-persisting helper', () => {
      component.openFullScreen();

      const config = mockMatDialog.open.calls.mostRecent().args[1];
      expect(config?.closeOnNavigation).toBe(false);
    });

    // When still alive the note routes out via `changed`.
    it('persists the edit via `changed` when a navigation closes the dialog', () => {
      spyOn(component.changed, 'emit');
      component.openFullScreen();

      navigate();
      // The dialog resolves through its save path with the typed content.
      afterClosed$.next('typed before resize');

      expect(component.changed.emit).toHaveBeenCalledWith('typed before resize');
    });

    // The production scenario: the breakpoint switch destroys this host while
    // the editor is open, so the save must land via the direct dispatch (#8432).
    it('persists directly when a navigation closes the dialog after host destroy', () => {
      component.openFullScreen();
      component.ngOnDestroy();

      navigate();
      afterClosed$.next('typed before resize');

      expect(store.dispatch).toHaveBeenCalledWith(
        TaskSharedActions.updateTask({
          task: { id: 'task-1', changes: { notes: 'typed before resize' } },
        }),
      );
    });
  });
});
