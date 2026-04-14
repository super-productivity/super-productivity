import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GlobalConfigService } from '../../config/global-config.service';
import { DateService } from '../../../core/date/date.service';

@Component({
  selector: 'notes-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <textarea
      class="notes-input"
      [ngModel]="noteTxt()"
      (ngModelChange)="onNoteChange($event)"
      placeholder="Write your notes for today..."
    ></textarea>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .notes-input {
        width: 100%;
        height: 100%;
        min-height: 100px;
        border: none;
        outline: none;
        resize: none;
        padding: var(--s2);
        font-family: inherit;
        font-size: 0.9em;
        line-height: 1.5;
        background: transparent;
        color: var(--text-color);
      }

      .notes-input::placeholder {
        color: var(--text-color-muted);
      }
    `,
  ],
})
export class NotesWidgetComponent {
  private _configService = inject(GlobalConfigService);
  private _dateService = inject(DateService);

  noteTxt = computed(() => this._configService.cfg()?.dailySummaryNote?.txt ?? '');

  onNoteChange(txt: string): void {
    this._configService.updateSection(
      'dailySummaryNote',
      {
        txt: txt.length === 0 ? undefined : txt,
        lastUpdateDayStr: this._dateService.todayStr(),
      },
      true,
    );
  }
}
