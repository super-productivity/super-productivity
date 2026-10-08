import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const STROKE_WIDTH = 2;
const VIEWBOX_SIZE = 44;

const clampProgress = (value: number | null | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 0) {
      return 0;
    }
    if (value > 100) {
      return 100;
    }
    return value;
  }
  return null;
};

const HOST_COLOR_VAR = '[style.--progress-circle-color]' as const;

const HOST_BINDINGS = {
  [HOST_COLOR_VAR]: 'colorValue()',
} as const;

@Component({
  selector: 'progress-circle',
  standalone: true,
  templateUrl: './progress-circle.component.html',
  styleUrls: ['./progress-circle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: HOST_BINDINGS,
})
export class ProgressCircleComponent {
  readonly progress = input<number | null, number | null | undefined>(null, {
    transform: clampProgress,
  });
  readonly color = input<string | null, string | null | undefined>(null, {
    transform: (value) => value ?? null,
  });

  readonly size = VIEWBOX_SIZE;
  readonly strokeWidth = STROKE_WIDTH;
  readonly center = VIEWBOX_SIZE / 2;
  readonly radius = this.center - STROKE_WIDTH;
  readonly circumference = 2 * Math.PI * this.radius;
  readonly viewBox = `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`;

  readonly showProgress = computed(() => this.progress() !== null);

  readonly progressRatio = computed(() => {
    const value = this.progress();
    return value === null ? null : value / 100;
  });

  readonly dashOffset = computed(() => {
    const ratio = this.progressRatio();
    if (ratio === null) {
      return this.circumference;
    }
    return this.circumference * (1 - ratio);
  });

  readonly colorValue = computed(() => this.color());
}
