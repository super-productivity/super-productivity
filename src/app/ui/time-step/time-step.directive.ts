import { Directive, ElementRef, HostListener, inject } from '@angular/core';
import { stepTimeString } from '../../util/step-time-string';

@Directive({
  selector: 'input[type=time][spTimeStep]',
  standalone: true,
})
export class TimeStepDirective {
  private readonly _el = inject(ElementRef<HTMLInputElement>);

  @HostListener('keydown', ['$event'])
  onKeyDown(ev: KeyboardEvent): void {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;

    const isSmall = ev.shiftKey;
    const isLarge = ev.ctrlKey || ev.metaKey;

    if (!isSmall && !isLarge) return;

    const el = this._el.nativeElement;
    if (el.disabled || el.readOnly) return;

    ev.preventDefault();

    const oldValue = el.value;
    if (!oldValue) return;

    const direction = ev.key === 'ArrowUp' ? 1 : -1;
    // large step takes precedence if both modifiers somehow match
    const stepSize = isLarge ? 15 : 5;
    const result = stepTimeString(oldValue, direction * stepSize);

    if (result === null) return;

    el.value = result;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
