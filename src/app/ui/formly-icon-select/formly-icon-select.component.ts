import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { isObservable, Observable, of } from 'rxjs';
import { MatIcon } from '@angular/material/icon';
import { MatOption, MatSelect, MatSelectTrigger } from '@angular/material/select';
import { FormlyModule } from '@ngx-formly/core';
import { FormlyFieldSelect } from '@ngx-formly/material/select';

export interface IconSelectOption {
  value: unknown;
  label: string;
  icon?: string;
}

/**
 * A formly `select` whose options can carry a leading icon, shown in the list
 * and in the closed field. Options are a flat list (no groups), as an array or
 * an Observable: the translate extension turns static option arrays into one.
 * Icons go through `fontIcon`, so their names stay out of the
 * option text that mat-select uses for the trigger and typeahead.
 */
@Component({
  selector: 'formly-icon-select',
  standalone: true,
  imports: [
    AsyncPipe,
    ReactiveFormsModule,
    FormlyModule,
    MatSelect,
    MatSelectTrigger,
    MatOption,
    MatIcon,
  ],
  template: `
    <mat-select
      [id]="id"
      [formControl]="formControl"
      [formlyAttributes]="field"
      [placeholder]="props.placeholder"
      [tabIndex]="props.tabindex"
      [required]="required"
      [compareWith]="props.compareWith"
      (selectionChange)="change($event)"
      [errorStateMatcher]="errorStateMatcher"
      [aria-label]="_getAriaLabel()"
      [aria-labelledby]="_getAriaLabelledby()"
    >
      @let iconOptions = (iconOptions$ | async) ?? [];
      <mat-select-trigger>
        @for (item of iconOptions; track $index) {
          @if (props.compareWith(item.value, formControl.value)) {
            <span class="trigger">
              @if (item.icon) {
                <mat-icon [fontIcon]="item.icon"></mat-icon>
              }
              <span>{{ item.label }}</span>
            </span>
          }
        }
      </mat-select-trigger>
      @for (item of iconOptions; track $index) {
        <mat-option [value]="item.value">
          @if (item.icon) {
            <mat-icon [fontIcon]="item.icon"></mat-icon>
          }
          {{ item.label }}
        </mat-option>
      }
    </mat-select>
  `,
  styles: `
    .trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--s);
      vertical-align: middle;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyIconSelectComponent extends FormlyFieldSelect {
  private _optionsSource?: unknown;
  private _iconOptions$: Observable<IconSelectOption[]> = of([]);

  // Cached per source, so the async pipe keeps one subscription.
  get iconOptions$(): Observable<IconSelectOption[]> {
    const source = this.props.options;
    if (source !== this._optionsSource) {
      this._optionsSource = source;
      this._iconOptions$ = isObservable(source)
        ? (source as Observable<IconSelectOption[]>)
        : of(Array.isArray(source) ? (source as IconSelectOption[]) : []);
    }
    return this._iconOptions$;
  }
}
