import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { InlineInputComponent } from './inline-input.component';

describe('InlineInputComponent', () => {
  const minute = 60 * 1000;
  const hour = 60 * minute;
  let fixture: ComponentFixture<InlineInputComponent>;
  let changed: jasmine.Spy;
  let input: HTMLInputElement;

  const create = (type: 'text' | 'duration', value: string | number): void => {
    fixture = TestBed.createComponent(InlineInputComponent);
    fixture.componentRef.setInput('type', type);
    fixture.componentRef.setInput('value', value);
    changed = jasmine.createSpy('changed');
    fixture.componentInstance.changed.subscribe(changed);
    fixture.detectChanges();
    tick();
    input = fixture.nativeElement.querySelector('input');
  };

  const typeText = (text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };

  // An outside update, such as a sync op or another window, while the field is focused.
  const setValue = (value: string | number): void => {
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
    tick();
  };

  // Dispatched rather than input.blur(), which fires nothing without real focus.
  const blur = (): void => {
    input.dispatchEvent(new Event('blur'));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InlineInputComponent, TranslateModule.forRoot()],
    });
  });

  it('does not save text typed before an outside value change replaced it', fakeAsync(() => {
    create('text', 'Old title');

    typeText('Typed title');
    setValue('Synced title');
    expect(input.value).toBe('Synced title');
    blur();

    expect(changed.calls.allArgs()).toEqual([]);
  }));

  it('does not save a duration typed before an outside value change replaced it', fakeAsync(() => {
    create('duration', 0);

    typeText('1h');
    setValue(2 * hour);
    expect(input.value).toBe('2h');
    // The shown value parses to the value the field already holds, so it emits nothing.
    typeText('2h');
    blur();

    expect(changed.calls.allArgs()).toEqual([]);
  }));

  it('does not save a committed edit again when the value stays the same', fakeAsync(() => {
    create('duration', 0);

    typeText('30m');
    blur();
    expect(changed).toHaveBeenCalledOnceWith(30 * minute);
    changed.calls.reset();

    // The parent still shows 0, as the planner's remaining time does once time
    // spent exceeds the new estimate. A later focus and blur must not save again.
    blur();

    expect(changed.calls.allArgs()).toEqual([]);
  }));
});
