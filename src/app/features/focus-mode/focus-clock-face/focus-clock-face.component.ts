import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BreathingDotComponent } from '../../../ui/breathing-dot/breathing-dot.component';

export type FocusClockFaceVariant = 'ring' | 'breathing';

@Component({
  selector: 'focus-clock-face',
  templateUrl: './focus-clock-face.component.html',
  styleUrls: ['./focus-clock-face.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BreathingDotComponent],
})
export class FocusClockFaceComponent {
  readonly variant = input<FocusClockFaceVariant>('ring');
  readonly progress = input<number>(0);
  readonly isPaused = input<boolean>(false);

  readonly isRing = computed(() => this.variant() === 'ring');
  readonly isBreathing = computed(() => this.variant() === 'breathing');
}
