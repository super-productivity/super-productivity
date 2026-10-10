import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { DoneToggleComponent } from './done-toggle.component';

@Component({
  standalone: true,
  imports: [DoneToggleComponent],
  template: `
    <done-toggle
      [isDone]="isDone()"
      [isWontDo]="isWontDo()"
      [isMultiSelectAware]="isMultiSelectAware()"
      (toggled)="toggledCount = toggledCount + 1"
    ></done-toggle>
  `,
})
class HostComponent {
  readonly isMultiSelectAware = signal(false);
  readonly isDone = signal(false);
  readonly isWontDo = signal(false);
  toggledCount = 0;
}

describe('DoneToggleComponent', () => {
  const clickWith = (
    init: MouseEventInit,
  ): { host: HostComponent; ev: MouseEvent; el: HTMLElement } => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('done-toggle') as HTMLElement;
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    return { host: fixture.componentInstance, ev, el };
  };

  it('toggles and stops propagation on a plain click', () => {
    const { host, ev, el } = clickWith({});
    const stopped = spyOn(ev, 'stopPropagation');
    el.dispatchEvent(ev);
    expect(host.toggledCount).toBe(1);
    expect(stopped).toHaveBeenCalled();
  });

  // The Planner uses this same component and has no multi-select, so a
  // modifier click there must keep marking the task done. Bailing
  // unconditionally swallowed the toggle AND let the click bubble to the
  // planner row, which opened the detail panel instead.
  it('toggles on a modifier click when the host is not multi-select aware', () => {
    const { host, ev, el } = clickWith({ ctrlKey: true });
    const stopped = spyOn(ev, 'stopPropagation');
    el.dispatchEvent(ev);
    expect(host.toggledCount).toBe(1);
    // The other half of the reported symptom: the swallowed toggle ALSO let the
    // click reach the planner row, which opened the detail panel. Emitting
    // without stopping here would still leave that behaviour broken.
    expect(stopped).toHaveBeenCalled();
  });

  // A task finished as "won't do" is done, so it keeps the shared `done-check`
  // styling and swaps only the glyph.
  describe('wont do', () => {
    const glyphFor = (isWontDo: boolean): SVGElement | null => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.componentInstance.isDone.set(true);
      fixture.componentInstance.isWontDo.set(isWontDo);
      fixture.detectChanges();
      return fixture.nativeElement.querySelector('.done-check');
    };

    it('draws a checkmark for a normally completed task', () => {
      const glyph = glyphFor(false);
      expect(glyph?.tagName).toBe('polyline');
      expect(glyph?.classList).not.toContain('done-check--cross');
    });

    it('draws a cross instead of the checkmark', () => {
      const glyph = glyphFor(true);
      expect(glyph?.tagName).toBe('path');
      expect(glyph?.classList).toContain('done-check--cross');
    });
  });

  it('lets a modifier click bubble untouched when the host is multi-select aware', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.isMultiSelectAware.set(true);
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('done-toggle') as HTMLElement;
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    const stopped = spyOn(ev, 'stopPropagation');
    el.dispatchEvent(ev);
    expect(fixture.componentInstance.toggledCount).toBe(0);
    expect(stopped).not.toHaveBeenCalled();
  });
});
