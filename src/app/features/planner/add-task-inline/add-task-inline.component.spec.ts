import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { AddTaskInlineComponent } from './add-task-inline.component';
import { ADD_TASK_INLINE_BTN_SELECTOR } from './add-task-inline.const';

/**
 * Contract test for the `data-add-task-btn` marker. Keyboard focus recovery
 * after a bulk action looks the collapsed add button up by
 * `add-task-inline [data-add-task-btn]` (board-panel.component.ts,
 * task-bulk-action.service.ts). Those call sites build their own DOM fixtures,
 * so without this spec dropping the attribute from the real template would
 * leave every test green and only break focus at runtime.
 *
 * Goes through a host component on purpose: a directly created fixture renders
 * into a generic root div, and the `add-task-inline` half of the selector under
 * test would never be exercised.
 */
@Component({
  imports: [AddTaskInlineComponent],
  template: `<add-task-inline></add-task-inline>`,
})
class TestHostComponent {}

describe('AddTaskInlineComponent', () => {
  it('should mark the collapsed add button so focus recovery can find it', () => {
    TestBed.configureTestingModule({
      imports: [TestHostComponent, NoopAnimationsModule, TranslateModule.forRoot()],
    });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const found = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      ADD_TASK_INLINE_BTN_SELECTOR,
    );

    expect(found).toBeTruthy();
    expect(found!.tagName).toBe('BUTTON');
  });
});
