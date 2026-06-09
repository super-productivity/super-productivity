import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Presentational 4-row skeleton shared by the timer screens (focus session +
 * break). Rows, top-down:
 *
 *   [fmTop]    top controls (mode selector / simple counters) — reserved height
 *   [fmTask]   task title — content height
 *   [fmClock]  clock face — the only flexing row, centers its content
 *   [fmBottom] action row — content height, clears the screen edge
 *
 * Only the layout lives here; behaviour, state and the projected content's own
 * styling stay in the consuming component (focus-mode-main / focus-mode-break).
 * The reserved top-row height keeps the task/clock baseline stable across the
 * focus ↔ break transition and across main's prep ↔ in-progress states.
 */
@Component({
  selector: 'focus-mode-layout',
  standalone: true,
  template: `
    <div class="top"><ng-content select="[fmTop]"></ng-content></div>
    <div class="task"><ng-content select="[fmTask]"></ng-content></div>
    <div class="clock"><ng-content select="[fmClock]"></ng-content></div>
    <div class="bottom"><ng-content select="[fmBottom]"></ng-content></div>
  `,
  styleUrl: './focus-mode-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FocusModeLayoutComponent {}
