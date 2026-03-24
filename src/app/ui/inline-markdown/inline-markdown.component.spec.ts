import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownModule } from 'ngx-markdown';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { InlineMarkdownComponent } from './inline-markdown.component';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { ClipboardImageService } from '../../core/clipboard-image/clipboard-image.service';
import { provideMockStore } from '@ngrx/store/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';

describe('InlineMarkdownComponent', () => {
  let component: InlineMarkdownComponent;
  let fixture: ComponentFixture<InlineMarkdownComponent>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockClipboardImageService: jasmine.SpyObj<ClipboardImageService>;

  beforeEach(async () => {
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      tasks: jasmine.createSpy().and.returnValue({ isTurnOffMarkdown: false }),
    });
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockClipboardImageService = jasmine.createSpyObj('ClipboardImageService', [
      'resolveMarkdownImages',
    ]);
    mockClipboardImageService.resolveMarkdownImages.and.callFake((content: string) =>
      Promise.resolve(content),
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

  describe('keypressHandler', () => {
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
  
  describe('ngOnDestroy', () => {
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

  describe('_handleCheckboxClick', () => {
    let mockPreviewEl: { element: { nativeElement: HTMLElement } };

    beforeEach(() => {
      mockPreviewEl = {
        element: {
          nativeElement: document.createElement('div'),
        },
      };
      spyOn(component, 'previewEl').and.returnValue(mockPreviewEl as any);
      spyOn(component.changed, 'emit');
    });

    it('should toggle first checkbox in simple checklist', () => {
      // Arrange
      component.model = '- [ ] Task 1\n- [ ] Task 2';
      fixture.detectChanges();

      // Create mock checkbox wrappers
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act
      component['_handleCheckboxClick'](wrapper1);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith('- [x] Task 1\n- [ ] Task 2');
    });

    it('should toggle checkbox after blank line', () => {
      // Arrange - this is the bug scenario from issue #5950
      component.model = '- [ ] Task 1\n\n- [ ] Task 2';
      fixture.detectChanges();

      // Create mock checkbox wrappers (blank line doesn't create a wrapper)
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act - click the second checkbox (Task 2)
      component['_handleCheckboxClick'](wrapper2);

      // Assert - Task 2 should be toggled, not Task 1
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n\n- [x] Task 2');
    });

    it('should toggle checkbox with multiple blank lines', () => {
      // Arrange
      component.model = '- [ ] Task 1\n\n\n- [ ] Task 2\n\n- [ ] Task 3';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      const wrapper3 = document.createElement('li');
      wrapper3.className = 'checkbox-wrapper';
      wrapper3.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 3';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);
      mockPreviewEl.element.nativeElement.appendChild(wrapper3);

      // Act - click the third checkbox (Task 3)
      component['_handleCheckboxClick'](wrapper3);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(
        '- [ ] Task 1\n\n\n- [ ] Task 2\n\n- [x] Task 3',
      );
    });

    it('should uncheck a checked checkbox', () => {
      // Arrange
      component.model = '- [x] Task 1\n- [ ] Task 2';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      wrapper1.innerHTML = '<span class="checkbox material-icons">check_box</span>Task 1';

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      wrapper2.innerHTML =
        '<span class="checkbox material-icons">check_box_outline_blank</span>Task 2';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act
      component['_handleCheckboxClick'](wrapper1);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n- [ ] Task 2');
    });
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
      spyOn(component.changed, 'emit');
    });

    it('should handle checkbox click when checkbox is wrapped in <p> tag (loose list)', () => {
      // Arrange - simulates loose list HTML: <li class="checkbox-wrapper"><p><span class="checkbox">...</span>Task</p></li>
      component.model = '- [ ] Task 1\n\n- [ ] Task 2';
      fixture.detectChanges();

      // Build DOM structure for loose list (with <p> wrapper)
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper undone';
      const p1 = document.createElement('p');
      const checkbox1 = document.createElement('span');
      checkbox1.className = 'checkbox material-icons';
      checkbox1.textContent = 'check_box_outline_blank';
      p1.appendChild(checkbox1);
      p1.appendChild(document.createTextNode('Task 1'));
      wrapper1.appendChild(p1);

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper undone';
      const p2 = document.createElement('p');
      const checkbox2 = document.createElement('span');
      checkbox2.className = 'checkbox material-icons';
      checkbox2.textContent = 'check_box_outline_blank';
      p2.appendChild(checkbox2);
      p2.appendChild(document.createTextNode('Task 2'));
      wrapper2.appendChild(p2);

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act - simulate clicking the second checkbox
      const mockEvent = {
        target: checkbox2,
      } as unknown as MouseEvent;
      component.clickPreview(mockEvent);

      // Assert - Task 2 should be toggled
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n\n- [x] Task 2');
    });

    it('should toggle checkbox when clicking on the label text (not just the checkbox icon)', () => {
      // Arrange
      component.model = '- [ ] Task 1\n- [ ] Task 2';
      fixture.detectChanges();

      // Build DOM structure
      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper undone';
      const checkbox1 = document.createElement('span');
      checkbox1.className = 'checkbox material-icons';
      checkbox1.textContent = 'check_box_outline_blank';
      const textNode1 = document.createTextNode('Task 1');
      wrapper1.appendChild(checkbox1);
      wrapper1.appendChild(textNode1);

      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper undone';
      const checkbox2 = document.createElement('span');
      checkbox2.className = 'checkbox material-icons';
      checkbox2.textContent = 'check_box_outline_blank';
      const textSpan2 = document.createElement('span');
      textSpan2.textContent = 'Task 2';
      wrapper2.appendChild(checkbox2);
      wrapper2.appendChild(textSpan2);

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act - simulate clicking on the text span (not the checkbox icon)
      const mockEvent = {
        target: textSpan2,
      } as unknown as MouseEvent;
      component.clickPreview(mockEvent);

      // Assert - Task 2 should be toggled
      expect(component.changed.emit).toHaveBeenCalledWith('- [ ] Task 1\n- [x] Task 2');
    });

    it('should toggle checkbox when clicking directly on the checkbox-wrapper element', () => {
      // Arrange
      component.model = '- [ ] Task 1';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper undone';
      const checkbox1 = document.createElement('span');
      checkbox1.className = 'checkbox material-icons';
      checkbox1.textContent = 'check_box_outline_blank';
      wrapper1.appendChild(checkbox1);
      wrapper1.appendChild(document.createTextNode('Task 1'));

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);

      // Act - simulate clicking directly on the wrapper
      const mockEvent = {
        target: wrapper1,
      } as unknown as MouseEvent;
      component.clickPreview(mockEvent);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith('- [x] Task 1');
    });

    it('should not toggle checkbox when clicking on a link', () => {
      // Arrange
      component.model = '- [ ] Task with [link](http://example.com)';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper undone';
      const checkbox1 = document.createElement('span');
      checkbox1.className = 'checkbox material-icons';
      checkbox1.textContent = 'check_box_outline_blank';
      const link = document.createElement('a');
      link.href = 'http://example.com';
      link.textContent = 'link';
      wrapper1.appendChild(checkbox1);
      wrapper1.appendChild(document.createTextNode('Task with '));
      wrapper1.appendChild(link);

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);

      // Act - simulate clicking on the link
      const mockEvent = {
        target: link,
      } as unknown as MouseEvent;
      component.clickPreview(mockEvent);

      // Assert - checkbox should NOT be toggled (link should work normally)
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should toggle edit mode when clicking outside checkbox-wrapper', () => {
      // Arrange
      component.model = 'Some regular text';
      fixture.detectChanges();

      const paragraph = document.createElement('p');
      paragraph.textContent = 'Some regular text';
      mockPreviewEl.element.nativeElement.appendChild(paragraph);

      spyOn<any>(component, '_toggleShowEdit');

      // Act - simulate clicking on regular text
      const mockEvent = {
        target: paragraph,
      } as unknown as MouseEvent;
      component.clickPreview(mockEvent);

      // Assert
      expect(component['_toggleShowEdit']).toHaveBeenCalled();
      expect(component.changed.emit).not.toHaveBeenCalled();
    });
  });

  describe('toggleChecklistMode', () => {
    it('should preserve unsaved textarea content when adding checklist item while focused', () => {
      // Arrange
      const originalValue = 'original text';
      const unsavedValue = 'unsaved typed content';
      spyOn(component.changed, 'emit');

      component.model = originalValue;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: unsavedValue,
          selectionStart: unsavedValue.length,
          focus: () => {},
          setSelectionRange: () => {},
          style: {},
        },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl as any);
      spyOn(component, 'wrapperEl').and.returnValue({
        nativeElement: { style: {} },
      } as any);

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

      component.model = value;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value,
          selectionStart: value.length,
          focus: () => {},
          setSelectionRange: () => {},
          style: {},
        },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl as any);
      spyOn(component, 'wrapperEl').and.returnValue({
        nativeElement: { style: {} },
      } as any);

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

    it('should insert checklist item after cursor line, not at end', () => {
      // Arrange
      const text = '- [ ] First\n- [ ] Second\n- [ ] Third';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 5, // middle of "First" line
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 17, // on "A" line
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 0,
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — inserts after the first (and only) line
      expect(component.modelCopy()).toBe('- [ ] Only item\n- [ ] ');
    });

    it('should append to end when cursor is at end of text', () => {
      // Arrange
      const text = '- [ ] First\n- [ ] Second';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: text.length,
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — appended to end (same as old behavior)
      expect(component.modelCopy()).toBe('- [ ] First\n- [ ] Second\n- [ ] ');
    });

    it('should adjust cursor position after double-newline cleanup', () => {
      // Arrange — text with double newline before a checklist item
      const text = '- [ ] A\n\n- [ ] B';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 16, // on "B" line
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
      component.model = text;
      fixture.detectChanges();

      // isShowEdit was set to false by blur, but textarea still exists in DOM
      component['isShowEdit'].set(false);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 12, // end of "asdasd"
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 5, // middle of "First" line
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 0,
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — leading newline cleaned, just "- [ ] "
      expect(component.modelCopy()).toBe('- [ ] ');
    });

    it('should handle isDefaultText while editing (textarea exists)', () => {
      // Arrange
      spyOn(component.changed, 'emit');

      component.model = '';
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: '',
          selectionStart: 0,
          focus: jasmine.createSpy('focus'),
          setSelectionRange: jasmine.createSpy('setSelectionRange'),
          style: {},
          scrollHeight: 100,
          offsetHeight: 100,
        },
      };
      spyOn(component, 'textareaEl').and.returnValue(mockTextareaEl as any);
      spyOn(component, 'isDefaultText').and.returnValue(true);
      spyOn(component, 'wrapperEl').and.returnValue({
        nativeElement: { style: {} },
      } as any);

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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 11, // after the trailing newline
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — inserts after the empty line at end
      expect(component.modelCopy()).toBe('- [ ] Item\n- [ ] ');
    });

    it('should set isChecklistMode to true after insertion from textarea', () => {
      // Arrange
      const text = '- [ ] A\n- [ ] B';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: text.length,
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      // Cursor at end of "B" line (position: "- [ ] A\n- [ ] B".length = 15)
      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 15,
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.modelCopy()).toBe('- [ ] A\n- [ ] B\n- [ ] \n- [ ] C');
    });

    it('should produce exact output when inserting into text with mixed content', () => {
      // Arrange
      const text = 'Some notes\n- [ ] Task';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: text.length,
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert
      expect(component.modelCopy()).toBe('Some notes\n- [ ] Task\n- [ ] ');
    });

    it('should update model when textarea value differs from model', () => {
      // Arrange
      component.model = 'old';
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: 'new',
          selectionStart: 3,
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — model reflects the final value (textarea content + checklist item)
      expect(component.model).toBe('new\n- [ ] ');
    });

    it('should not lose new checklist item when model setter is called after emit (Angular CD simulation)', () => {
      // Arrange
      const text = '- [ ] Existing';
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);
      spyOn(component.changed, 'emit');

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: text.length,
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
      component.model = initialText;
      fixture.detectChanges();

      component['isShowEdit'].set(true);
      spyOn(component.changed, 'emit');

      const mockTextareaEl = {
        nativeElement: {
          value: initialText,
          selectionStart: initialText.length,
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);
      spyOn(component.changed, 'emit');

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: text.length,
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
      component.model = text;
      fixture.detectChanges();

      component['isShowEdit'].set(true);

      const mockTextareaEl = {
        nativeElement: {
          value: text,
          selectionStart: 7, // at the '\n' between A and B
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

      const mockEvent = { preventDefault: () => {}, stopPropagation: () => {} } as any;

      // Act
      component.toggleChecklistMode(mockEvent);

      // Assert — new item inserted between A and B
      expect(component.modelCopy()).toBe('- [ ] A\n- [ ] \n- [ ] B');
    });
  });

  describe('model setter race condition', () => {
    it('should not show stale notes when switching from a task with notes to one without', async () => {
      // Arrange: make resolveMarkdownImages return a delayed promise
      let resolveDelayed!: (value: string) => void;
      mockClipboardImageService.resolveMarkdownImages.and.returnValue(
        new Promise<string>((resolve) => {
          resolveDelayed = resolve;
        }),
      );

      // Act: set model to a task with notes, then immediately clear it
      component.model = 'Task A notes';
      component.model = '';

      // Now the delayed promise resolves with the old content
      resolveDelayed('Task A notes');
      await Promise.resolve();

      // Assert: resolvedModel should remain empty (not stale Task A content)
      expect(component.resolvedModel()).toBe('');
    });
  });

  describe('_handleCheckboxClick edge cases', () => {
    let mockPreviewEl: { element: { nativeElement: HTMLElement } };

    beforeEach(() => {
      mockPreviewEl = {
        element: {
          nativeElement: document.createElement('div'),
        },
      };
      spyOn(component, 'previewEl').and.returnValue(mockPreviewEl as any);
      spyOn(component.changed, 'emit');
    });

    it('should preserve blank lines when toggling checkboxes', () => {
      // Arrange
      component.model = '- [ ] Task 1\n\n- [ ] Task 2\n\n- [ ] Task 3';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      const wrapper3 = document.createElement('li');
      wrapper3.className = 'checkbox-wrapper';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);
      mockPreviewEl.element.nativeElement.appendChild(wrapper3);

      // Act - toggle Task 2
      component['_handleCheckboxClick'](wrapper2);

      // Assert - blank lines should be preserved
      expect(component.changed.emit).toHaveBeenCalledWith(
        '- [ ] Task 1\n\n- [x] Task 2\n\n- [ ] Task 3',
      );
    });

    it('should handle mixed checked and unchecked items', () => {
      // Arrange
      component.model = '- [x] Done\n- [ ] Todo\n- [x] Also Done';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';
      const wrapper3 = document.createElement('li');
      wrapper3.className = 'checkbox-wrapper';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);
      mockPreviewEl.element.nativeElement.appendChild(wrapper3);

      // Act - toggle the middle item (Todo -> Done)
      component['_handleCheckboxClick'](wrapper2);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(
        '- [x] Done\n- [x] Todo\n- [x] Also Done',
      );
    });

    it('should handle checklist with text before it', () => {
      // Arrange
      component.model = 'Some intro text\n\n- [ ] Task 1\n- [ ] Task 2';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act
      component['_handleCheckboxClick'](wrapper1);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(
        'Some intro text\n\n- [x] Task 1\n- [ ] Task 2',
      );
    });

    it('should handle checklist with text after it', () => {
      // Arrange
      component.model = '- [ ] Task 1\n- [ ] Task 2\n\nSome outro text';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      const wrapper2 = document.createElement('li');
      wrapper2.className = 'checkbox-wrapper';

      mockPreviewEl.element.nativeElement.appendChild(wrapper1);
      mockPreviewEl.element.nativeElement.appendChild(wrapper2);

      // Act
      component['_handleCheckboxClick'](wrapper2);

      // Assert
      expect(component.changed.emit).toHaveBeenCalledWith(
        '- [ ] Task 1\n- [x] Task 2\n\nSome outro text',
      );
    });

    it('should not emit if model is undefined', () => {
      // Arrange
      component.model = '';
      fixture.detectChanges();

      const wrapper1 = document.createElement('li');
      wrapper1.className = 'checkbox-wrapper';
      mockPreviewEl.element.nativeElement.appendChild(wrapper1);

      // Act
      component['_handleCheckboxClick'](wrapper1);

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });

    it('should not emit if clicked element is not found in DOM', () => {
      // Arrange
      component.model = '- [ ] Task 1';
      fixture.detectChanges();

      // Create a wrapper that's NOT in the previewEl
      const orphanWrapper = document.createElement('li');
      orphanWrapper.className = 'checkbox-wrapper';

      // Act
      component['_handleCheckboxClick'](orphanWrapper);

      // Assert
      expect(component.changed.emit).not.toHaveBeenCalled();
    });
  });
});
