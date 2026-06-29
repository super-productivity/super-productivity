import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BreathingDotComponent } from '../../../ui/breathing-dot/breathing-dot.component';
import { fadeSwapAnimation } from '../../../ui/animations/fade.ani';

export type FocusClockFaceVariant = 'ring' | 'breathing';

@Component({
  selector: 'focus-clock-face',
  templateUrl: './focus-clock-face.component.html',
  styleUrls: ['./focus-clock-face.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sequentially cross-fade the ring ↔ breathing layers (absolutely stacked) so
  // the variant swap on the Flowtime prep ↔ in-progress transition isn't a hard
  // cut — the old layer fades out before the new one fades in.
  animations: [fadeSwapAnimation],
  imports: [BreathingDotComponent],
})
export class FocusClockFaceComponent {
  readonly variant = input<FocusClockFaceVariant>('ring');
  readonly progress = input<number>(0);
  readonly isPaused = input<boolean>(false);

  readonly isRing = computed(() => this.variant() === 'ring');
  readonly isBreathing = computed(() => this.variant() === 'breathing');
}
