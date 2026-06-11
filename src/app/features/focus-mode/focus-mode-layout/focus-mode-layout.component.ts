import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Presentational skeleton shared by the timer screens (focus session + break).
 * Slots, top-down:
 *
 *   [fmTop]    top controls (mode selector / simple counters) — pinned to the
 *              top, out of flow
 *   [fmTask]   task title — reserved height, content bottom-aligned (toward
 *              the clock)
 *   [fmClock]  clock face — natural height, centered within the group
 *   [fmBottom] action row — reserved height, content top-aligned (toward the
 *              clock)
 *
 * The task and bottom rows reserve the SAME height, so the clock sits at the
 * exact vertical center between them; the whole task · clock · bottom group is
 * then centered in the viewport, with the top controls floating above it. Equal
 * reserved rows keep the clock baseline stable across the focus ↔ break
 * transition and across main's prep ↔ in-progress states, regardless of what
 * each row holds.
 *
 * Only the layout lives here; behaviour, state and the projected content's own
 * styling stay in the consuming component (focus-mode-main / focus-mode-break).
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
