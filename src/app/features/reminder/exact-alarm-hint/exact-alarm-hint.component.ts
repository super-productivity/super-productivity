import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { ExactAlarmStatusService } from '../exact-alarm-status.service';

/**
 * Calm, inline note shown where a reminder is set while Android delivers
 * reminders inexactly. Renders nothing elsewhere. Issue #10684.
 */
@Component({
  selector: 'exact-alarm-hint',
  imports: [MatButton, MatIcon, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isDenied()) {
      <div
        class="callout"
        role="status"
      >
        <mat-icon aria-hidden="true">alarm_off</mat-icon>
        <div>
          <p>{{ T.F.REMINDER.EXACT_ALARM_HINT | translate }}</p>
          <button
            mat-button
            type="button"
            (click)="openSettings()"
          >
            {{ T.F.REMINDER.EXACT_ALARM_OPEN_SETTINGS | translate }}
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .callout {
      margin-top: var(--s2);
    }
  `,
})
export class ExactAlarmHintComponent {
  private _exactAlarmStatus = inject(ExactAlarmStatusService);

  readonly T = T;
  readonly isDenied = toSignal(this._exactAlarmStatus.isDenied$, {
    initialValue: false,
  });

  openSettings(): void {
    void this._exactAlarmStatus.openSettings();
  }
}
