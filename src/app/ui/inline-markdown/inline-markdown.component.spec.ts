import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MarkdownModule } from 'ngx-markdown';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { InlineMarkdownComponent } from './inline-markdown.component';
import { GlobalConfigService } from '../../features/config/global-config.service';

describe('InlineMarkdownComponent', () => {
  let component: InlineMarkdownComponent;
  let fixture: ComponentFixture<InlineMarkdownComponent>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;

  beforeEach(async () => {
    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      tasks: jasmine.createSpy().and.returnValue({ isTurnOffMarkdown: false }),
    });
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);

    await TestBed.configureTestingModule({
      imports: [InlineMarkdownComponent, MarkdownModule.forRoot(), NoopAnimationsModule],
      providers: [
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: MatDialog, useValue: mockMatDialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InlineMarkdownComponent);
    component = fixture.componentInstance;
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
