import { Directive, HostListener, inject } from '@angular/core';
import { isFileEml } from '../../util/is-file-eml';
import { EmlDropService } from './eml-drop.service';

@Directive({
  selector: '[emlDrop]',
})
export class EmlDropDirective {
  private readonly _emlDropService = inject(EmlDropService);

  // NOTE: the `drop` event only fires because AppComponent registers a global
  // `dragover` preventDefault() (to block file-drop navigation), which makes the
  // whole document — including this button — a valid drop target. We don't add a
  // per-host `dragover` listener on purpose: it would fire on every pointer move
  // during a drag and force change detection each time.
  @HostListener('drop', ['$event'])
  async onDrop(ev: DragEvent): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const files = ev.dataTransfer?.files ?? [];

    for (const file of Array.from(files)) {
      // Adds a task with the information inside the eml
      if (isFileEml(file)) {
        await this._emlDropService.createTaskFromEml(file);
      }
    }
  }
}
