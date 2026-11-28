import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'compact-segmented-control',
  imports: [MatButtonToggleGroup, MatButtonToggle, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './compact-segmented-control.component.scss',
  template: `
    <mat-button-toggle-group
      class="track"
      hideSingleSelectionIndicator
      [attr.aria-label]="ariaLabel()"
      [value]="value()"
      (change)="value.set($event.value)"
    >
      @for (option of options(); track option.value) {
        <mat-button-toggle
          class="option"
          [class.selected]="option.value === value()"
          [value]="option.value"
        >
          {{ option.labelKey | translate }}
        </mat-button-toggle>
      }
    </mat-button-toggle-group>
  `,
})
export class CompactSegmentedControlComponent<T extends string | number | boolean> {
  readonly options = input.required<ReadonlyArray<{ value: T; labelKey: string }>>();
  readonly ariaLabel = input.required<string>();
  readonly value = model.required<T>();
}
