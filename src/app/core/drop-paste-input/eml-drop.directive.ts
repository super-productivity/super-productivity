import { Directive, HostListener, inject } from '@angular/core';
import { isFileEml } from 'src/app/util/eml-parser';
import { EmlDropService } from './eml-drop.service';

@Directive({
  selector: '[emlDrop]',
})
export class EmlDropDirective {
  private readonly _emlDropService = inject(EmlDropService);

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
