import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FieldType, FieldTypeConfig, FormlyModule } from '@ngx-formly/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ProjectService } from '../../features/project/project.service';

@Component({
  selector: 'formly-habit-project-selection',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FormlyModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
  ],
  template: `
    <mat-form-field class="full-width">
      <mat-label>{{ props.label }}</mat-label>
      <mat-select
        [formControl]="formControl"
        [formlyAttributes]="field"
        multiple
      >
        @for (project of projects(); track project.id) {
          <mat-option [value]="project.id">
            {{ project.title }}
          </mat-option>
        }
      </mat-select>
      @if (props.description) {
        <mat-hint>{{ props.description }}</mat-hint>
      }
    </mat-form-field>
  `,
  styles: [
    `
      .full-width {
        width: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormlyHabitProjectSelectionComponent extends FieldType<FieldTypeConfig> {
  private _projectService = inject(ProjectService);

  projects = this._projectService.list;
}
