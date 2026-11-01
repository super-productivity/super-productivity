import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextDirectionDirective } from './text-direction.directive';

@Component({
  imports: [TextDirectionDirective],
  template:
    '<textarea [spTextDirection]="value()"></textarea><span [spTextDirection]="value()">{{ value() }}</span>',
})
class TestHostComponent {
  value = signal('English');
}

describe('TextDirectionDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.nativeElement.dir = 'rtl';
    fixture.detectChanges();
  });

  it('uses LTR in an RTL interface until a Persian/Arabic letter is present', () => {
    const text = fixture.nativeElement.querySelector('span') as HTMLElement;
    expect(getComputedStyle(text).direction).toBe('ltr');
    fixture.componentInstance.value.set('Docker را بررسی کن');
    fixture.detectChanges();
    expect(getComputedStyle(text).direction).toBe('rtl');
    expect(getComputedStyle(text).unicodeBidi).toBe('isolate');
    expect(getComputedStyle(text).textAlign).toBe('start');
  });

  it('follows typing and deletion even when the editor model commits only on blur', () => {
    const editor = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    for (const [value, direction] of [
      ['Docker فارسی', 'rtl'],
      ['Docker', 'ltr'],
    ]) {
      editor.value = value;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      expect(getComputedStyle(editor).direction).toBe(direction);
      expect(getComputedStyle(editor).unicodeBidi).toBe('isolate');
    }
    expect(fixture.componentInstance.value()).toBe('English');
  });
});
