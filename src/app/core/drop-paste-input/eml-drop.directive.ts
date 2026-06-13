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

    const file = ev.dataTransfer?.files[0];

    // EML File Addition on button hover
    // Adds a task with the information inside the eml
    if (file !== undefined && isFileEml(file)) {
      await this._emlDropService.createTaskFromEml(file);
    }
  }
}
