import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import { Project } from '../../project/project.model';
import { T } from '../../../t.const';

@Component({
  selector: 'dialog-select-project',
  template: `
    <h2 mat-dialog-title>{{ T.F.TASK.TASK_SELECTION.TITLE | translate }}</h2>
    <mat-dialog-content>
      @for (project of data.projects; track project.id) {
        <button
          mat-button
          [mat-dialog-close]="project.id"
          class="project-btn"
          type="button"
        >
          {{ project.title }}
        </button>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        mat-dialog-close
        type="button"
      >
        {{ T.G.CANCEL | translate }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .project-btn {
        width: 100%;
        justify-content: flex-start;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    TranslateModule,
  ],
})
export class DialogSelectProjectComponent {
  readonly data = inject<{ projects: Project[] }>(MAT_DIALOG_DATA);
  protected readonly T = T;
}
