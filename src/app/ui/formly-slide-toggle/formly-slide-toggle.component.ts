import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  MatSlideToggleChange,
  MatSlideToggleModule,
} from '@angular/material/slide-toggle';
import { FieldType, FormlyFieldConfig } from '@ngx-formly/core';

@Component({
  selector: 'formly-field-mat-slide-toggle',
  standalone: true,
  imports: [MatSlideToggleModule, MatInputModule, ReactiveFormsModule, MatIcon],
  template: `
    <mat-form-field>
      @if (props.description) {
        <!-- settings row: icon | label + description | switch. The text sits outside
             the toggle so it can wrap; aria-label/-describedby keep the switch named. -->
        @if (props.icon) {
          <mat-icon>{{ props.icon }}</mat-icon>
        } @else if (props.svgIcon) {
          <mat-icon [svgIcon]="props.svgIcon"></mat-icon>
        }
        <label
          class="row-text"
          [for]="toggle.buttonId"
        >
          <span>{{ props.label }}</span>
          <span
            class="row-description"
            [id]="id + '-description'"
            >{{ props.description }}</span
          >
        </label>
      }
      <mat-slide-toggle
        #toggle
        color="primary"
        [checked]="formControl.value"
        [aria-label]="props.description ? props.label : null"
        [aria-describedby]="props.description ? id + '-description' : ''"
        (change)="onChange($event)"
      >
        @if (!props.description) {
          {{ props.label }}
        }
      </mat-slide-toggle>
      <input
        aria-hidden="true"
        matInput
        tabindex="-1"
        readonly
        style="position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;"
        (focus)="toggle.focus()"
      />
      @if (!props.description) {
        @if (props.icon) {
          <mat-icon>{{ props.icon }}</mat-icon>
        } @else if (props.svgIcon) {
          <mat-icon [svgIcon]="props.svgIcon"></mat-icon>
        }
      }
    </mat-form-field>
  `,
  styles: [
    `
      :host ::ng-deep .mat-mdc-form-field-infix {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--s2);
      }
      mat-form-field {
        width: 100%;
      }
      mat-icon {
        flex-shrink: 0;
      }
      .row-text {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--s-quarter);
        cursor: pointer;
      }
      .row-description {
        color: var(--text-color-muted);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-snug);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlySlideToggleComponent extends FieldType<FormlyFieldConfig> {
  onChange(event: MatSlideToggleChange): void {
    const { checked } = event;
    this.formControl.setValue(checked);
  }
}
