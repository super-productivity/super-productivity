import { Directive, Input, signal } from '@angular/core';
import { getTextDirection } from '../../util/get-text-direction';

/** Apply the same content direction to display elements and native text editors. */
@Directive({
  selector: '[spTextDirection]',
  standalone: true,
  host: {
    ['[attr.dir]']: 'direction()',
    ['(input)']: 'onInput($event)',
    // plaintext would reapply the first-strong rule, ignoring our chosen base.
    style: 'unicode-bidi: isolate; text-align: start;',
  },
})
export class TextDirectionDirective {
  readonly direction = signal<'ltr' | 'rtl'>('ltr');

  @Input() set spTextDirection(text: string | null | undefined) {
    this.direction.set(getTextDirection(text));
  }

  onInput(event: Event): void {
    const target = event.target;
    // Some note editors commit their model on blur; direction still follows typing.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      this.direction.set(getTextDirection(target.value));
    }
  }
}
