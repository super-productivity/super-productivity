import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { nanoid } from 'nanoid';
import { dotAnimation } from './dot.ani';
import { T } from '../../../t.const';
import { InputDurationDirective } from '../input-duration.directive';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'input-duration-slider',
  templateUrl: './input-duration-slider.component.html',
  styleUrls: ['./input-duration-slider.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [dotAnimation],
  imports: [InputDurationDirective, FormsModule, TranslatePipe],
})
export class InputDurationSliderComponent implements OnInit, OnDestroy {
  private _el = inject(ElementRef);

  T: typeof T = T;

  // Convert to signals
  readonly minutesBefore = signal(0);
  readonly dots = signal<number[]>([]);
  readonly uid = 'duration-input-slider' + nanoid();
  readonly el: HTMLElement;

  // Input signals
  readonly label = input('');
  readonly model = input(0);
  // When true, the dial dynamically rescales above 1 hour: 5-min snap with
  // full-circle = 60 min while value < 1h, then 15-min snap with full-circle
  // = 6h once the value crosses the 60-min boundary. Default off; current
  // consumers keep the original linear-hours behavior.
  readonly useFlexibleIncrement = input(false);

  // Output remains the same
  readonly modelChange = output<number>();

  // Internal model signal
  readonly _model = signal(0);

  // Unsnapped accumulator for flex-mode drags. The snapped model value alone
  // can't accumulate sub-step motion (e.g., dragging 2° of a 5-min snap), so
  // we keep this in sync with the model externally and add raw deltas to it
  // during drag.
  private _flexAccumulatedMin = 0;

  startHandler?: (ev: MouseEvent | TouchEvent) => void;
  endHandler?: () => void;
  moveHandler?: (ev: MouseEvent | TouchEvent) => void;

  readonly circleEl = viewChild<ElementRef>('circleEl');

  constructor() {
    this.el = this._el.nativeElement;

    // Effect to handle model input changes
    effect(() => {
      const val = this.model();
      const validVal = !Number.isFinite(val) || Number.isNaN(val) ? 0 : val;
      if (this._model() !== validVal) {
        this._model.set(validVal);
        this.setRotationFromValue(validVal);
      }
    });
  }

  ngOnInit(): void {
    this.startHandler = (ev) => {
      if (!this.endHandler || !this.moveHandler || !this.circleEl()) {
        throw new Error();
      }

      // don't execute when clicked on label or input
      if (
        (ev.target as HTMLElement)?.tagName === 'LABEL' ||
        (ev.target as HTMLElement)?.tagName === 'INPUT'
      ) {
        this.endHandler();
        return;
      }

      this.el.addEventListener('mousemove', this.moveHandler);
      document.addEventListener('mouseup', this.endHandler);

      this.el.addEventListener('touchmove', this.moveHandler);
      document.addEventListener('touchend', this.endHandler);

      this.el.classList.add('is-dragging');
    };

    this.moveHandler = (ev) => {
      if (
        ev.type === 'click' &&
        ((ev.target as HTMLElement)?.tagName === 'LABEL' ||
          (ev.target as HTMLElement)?.tagName === 'INPUT')
      ) {
        return;
      }
      const circleEl = this.circleEl();
      if (!this.endHandler || !this.moveHandler || !circleEl) {
        throw new Error();
      }

      // prevent touchmove
      ev.preventDefault();

      const convertThetaToCssDegrees = (thetaIN: number): number => 90 - thetaIN;

      const centerX = circleEl.nativeElement.offsetWidth / 2;
      const centerY = circleEl.nativeElement.offsetHeight / 2;

      let offsetX: number;
      let offsetY: number;

      if (ev.type === 'touchmove') {
        const touchEv = ev as TouchEvent;
        const rect = (ev.target as Element).getBoundingClientRect();
        offsetX = touchEv.targetTouches[0].pageX - rect.left;
        offsetY = touchEv.targetTouches[0].pageY - rect.top;
      } else {
        const mouseEv = ev as MouseEvent;
        offsetX = mouseEv.offsetX;
        offsetY = mouseEv.offsetY;
      }

      const x = offsetX - centerX;
      const y = -1 * (offsetY - centerY);

      const theta = Math.atan2(y, x) * (180 / Math.PI);

      const cssDegrees = Math.round(convertThetaToCssDegrees(theta));
      this.setValueFromRotation(cssDegrees);
    };

    this.endHandler = () => {
      if (!this.endHandler || !this.moveHandler || !this.circleEl()) {
        throw new Error();
      }

      this.el.classList.remove('is-dragging');
      this.el.removeEventListener('mousemove', this.moveHandler);
      document.removeEventListener('mouseup', this.endHandler);

      this.el.removeEventListener('touchmove', this.moveHandler);
      document.removeEventListener('touchend', this.endHandler);
    };

    this.el.addEventListener('mousedown', this.startHandler);
    this.el.addEventListener('touchstart', this.startHandler);

    this.el.addEventListener('click', this.moveHandler);

    this.setRotationFromValue();
  }

  ngOnDestroy(): void {
    if (!this.endHandler || !this.moveHandler || !this.startHandler || !this.circleEl()) {
      throw new Error();
    }

    // remove mouse events
    this.el.removeEventListener('mousedown', this.startHandler);
    this.el.removeEventListener('mousemove', this.moveHandler);
    document.removeEventListener('mouseup', this.endHandler);

    // remove touch events
    this.el.removeEventListener('touchstart', this.startHandler);
    this.el.removeEventListener('touchmove', this.moveHandler);
    document.removeEventListener('touchend', this.endHandler);
  }

  setCircleRotation(cssDegrees: number): void {
    const circleEl = this.circleEl();
    if (!circleEl) {
      throw new Error();
    }
    circleEl.nativeElement.style.transform = 'rotate(' + cssDegrees + 'deg)';
  }

  setDots(hours: number = 0): void {
    // Ensure hours is a valid number
    if (!Number.isFinite(hours) || Number.isNaN(hours)) {
      hours = 0;
    }

    // Round to ensure we have an integer
    hours = Math.floor(hours);

    if (hours > 12) {
      hours = 12;
    }
    // prevent errors for negative values
    if (hours <= 0) {
      hours = 0;
    }

    this.dots.set(new Array(hours));
  }

  setValueFromRotation(degrees: number): void {
    if (this.useFlexibleIncrement()) {
      this._setValueFromRotationFlex(degrees);
      return;
    }

    const THRESHOLD = 40;

    let minutesFromDegrees;
    // NOTE: values are negative for the last quadrant
    if (degrees >= 0) {
      minutesFromDegrees = (degrees / 360) * 60;
    } else {
      minutesFromDegrees = ((degrees + 360) / 360) * 60;
    }

    minutesFromDegrees = Math.round(minutesFromDegrees / 5) * 5;

    if (minutesFromDegrees >= 60) {
      minutesFromDegrees = 0;
    }

    let hours = Math.floor(this._model() / (1000 * 60 * 60));

    const minuteDelta = minutesFromDegrees - this.minutesBefore();

    if (minuteDelta > THRESHOLD) {
      hours--;
    } else if (-1 * minuteDelta > THRESHOLD) {
      hours++;
    }

    if (hours < 0) {
      hours = 0;
      minutesFromDegrees = 0;
      this.setCircleRotation(0);
    } else {
      this.setCircleRotation(minutesFromDegrees * 6);
    }

    this.minutesBefore.set(minutesFromDegrees);
    this.setDots(hours);
    // eslint-disable-next-line no-mixed-operators
    const newValue = hours * 60 * 60 * 1000 + minutesFromDegrees * 60 * 1000;
    this._model.set(newValue);

    this.modelChange.emit(newValue);
  }

  // Hybrid drag math used when useFlexibleIncrement is enabled.
  // Below 60 min ("Mode A"): 5-min snap, 1° = 1/6 min, full circle = 60 min.
  // At/above 60 min ("Mode B"): 15-min snap, 1° = 1 min, full circle = 360 min
  // (top of dial pinned to the 60-min boundary).
  //
  // We accumulate value via the user's *raw* pointer-angle delta — not the
  // snap-quantized delta — because snapping near the 60-min boundary can
  // turn a real 15° ccw move into an apparent +345° "wrap" and bounce the
  // value back. Raw delta gives natural hysteresis: the user must drag far
  // enough that the rounded value actually crosses the boundary.
  // `minutesBefore` is repurposed in flex mode to store the previous raw
  // pointer angle (0–359, unsnapped).
  private _setValueFromRotationFlex(degrees: number): void {
    const absDeg = degrees >= 0 ? degrees : degrees + 360;
    const previousRawDeg = this.minutesBefore();

    // Shortest signed angular delta in (-180, 180]
    let rawDelta = absDeg - previousRawDeg;
    if (rawDelta > 180) rawDelta -= 360;
    if (rawDelta <= -180) rawDelta += 360;

    const wasInModeB = this._flexAccumulatedMin >= 60;

    // Mode-aware sensitivity: Mode A's full circle is 60 min (1° = 1/6 min);
    // Mode B's full circle is 360 min (1° = 1 min).
    const minPerDeg = wasInModeB ? 1 : 1 / 6;
    this._flexAccumulatedMin += rawDelta * minPerDeg;
    if (this._flexAccumulatedMin < 0) this._flexAccumulatedMin = 0;

    // Snap based on which mode we're heading into after the move
    const heading = this._flexAccumulatedMin >= 60;
    const snap = heading ? 15 : 5;
    let newMin = Math.round(this._flexAccumulatedMin / snap) * snap;

    // Clean mode-boundary crossings — anchor the accumulator to the
    // boundary so the next drag tick measures from a real value.
    if (!wasInModeB && newMin >= 60) {
      // A → B at the seam
      newMin = 60;
      this._flexAccumulatedMin = 60;
    } else if (wasInModeB && newMin < 60) {
      // B → A: last 5-min tick under an hour
      newMin = 55;
      this._flexAccumulatedMin = 55;
    }

    // Display degrees derived from the value
    const displayDeg = newMin >= 60 ? (newMin - 60) % 360 : (newMin * 6) % 360;

    // Store the raw pointer angle so subsequent deltas measure real motion
    this.minutesBefore.set(absDeg);
    this.setCircleRotation(displayDeg);
    this.setDots(0);

    const newValue = newMin * 60 * 1000;
    this._model.set(newValue);
    this.modelChange.emit(newValue);
  }

  onInputChange($event: number): void {
    this._model.set($event);
    this.modelChange.emit($event);
    this.setRotationFromValue();
  }

  setRotationFromValue(val?: number): void {
    const valueToUse = val ?? this._model();
    // Ensure val is a valid number, default to 0 if not
    const validVal =
      !Number.isFinite(valueToUse) || Number.isNaN(valueToUse) || valueToUse < 0
        ? 0
        : valueToUse;

    const totalMinutes = Math.floor(validVal / (1000 * 60));

    if (this.useFlexibleIncrement() && totalMinutes >= 60) {
      // Mode B mapping: 0° (top) = 60 min, 1° = 1 min, full lap = 6h.
      const degrees = (totalMinutes - 60) % 360;
      this.setDots(0);
      // Repurpose minutesBefore as previous-degrees in flex mode.
      this.minutesBefore.set(degrees);
      this._flexAccumulatedMin = totalMinutes;
      this.setCircleRotation(degrees);
      return;
    }

    const minutes = totalMinutes % 60;
    const hours = Math.floor(validVal / (1000 * 60 * 60));

    this.setDots(this.useFlexibleIncrement() ? 0 : hours);
    const degrees = (minutes * 360) / 60;
    // In flex mode (still Mode A), minutesBefore tracks degrees too.
    this.minutesBefore.set(this.useFlexibleIncrement() ? degrees : minutes);
    if (this.useFlexibleIncrement()) {
      this._flexAccumulatedMin = totalMinutes;
    }
    this.setCircleRotation(degrees);
  }
}
