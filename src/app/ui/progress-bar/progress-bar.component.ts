import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  inject,
  Input,
} from '@angular/core';

@Component({
  selector: 'progress-bar',
  template: '',
  styleUrls: ['./progress-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
})
export class ProgressBarComponent {
  private _elRef = inject(ElementRef);
  private _progress: number = 0;
  private _isAlwaysVisible: boolean = false;

  // TODO: Skipped for migration because:
  //  This input is used in combination with `@HostBinding` and migrating would
  //  break.
  @HostBinding('class') @Input() cssClass: string = 'bg-primary';

  @HostBinding('class.isAlwaysVisible') get isAlwaysVisibleClass(): boolean {
    return this._isAlwaysVisible;
  }

  @Input({ transform: booleanAttribute }) set isAlwaysVisible(value: boolean) {
    this._isAlwaysVisible = value;
    this._updateProgress();
  }

  // TODO: Skipped for migration because:
  //  Accessor inputs cannot be migrated as they are too complex.
  @Input() set progress(_value: number) {
    this._progress = _value;
    this._updateProgress();
  }

  private _updateProgress(): void {
    const val = Number.isFinite(this._progress)
      ? Math.min(Math.max(this._progress, 0), 100)
      : 0;
    const style = this._elRef.nativeElement.style;
    if (this._isAlwaysVisible) {
      style.visibility = 'visible';
      style.width = '100%';
      style.setProperty('--progress-bar-value', `${val}%`);
      return;
    }
    if (val > 1) {
      style.visibility = 'visible';
      style.width = `${val}%`;
    } else {
      style.visibility = 'hidden';
    }
  }
}
