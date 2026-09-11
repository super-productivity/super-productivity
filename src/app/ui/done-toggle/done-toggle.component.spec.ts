import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { DoneToggleComponent } from './done-toggle.component';

@Component({
  standalone: true,
  imports: [DoneToggleComponent],
  template: `
    <done-toggle
      [isDone]="false"
      [isMultiSelectAware]="isMultiSelectAware()"
      (toggled)="toggledCount = toggledCount + 1"
    ></done-toggle>
  `,
})
class HostComponent {
  readonly isMultiSelectAware = signal(false);
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
