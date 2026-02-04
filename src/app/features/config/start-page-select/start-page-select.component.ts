import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { ProjectService } from '../../project/project.service';
import { Project } from '../../project/project.model';
import { T } from 'src/app/t.const';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { MatOption, MatSelect } from '@angular/material/select';

@Component({
  selector: 'start-page-select',
  templateUrl: './start-page-select.component.html',
  styleUrls: ['./start-page-select.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    FormlyModule,
    AsyncPipe,
    TranslatePipe,
    MatSelect,
    MatOption,
  ],
})
export class StartPageSelectComponent extends FieldType<FormlyFieldConfig> {
  projectService = inject(ProjectService);

  T: typeof T = T;

  get type(): string {
    return this.to.type || 'text';
  }

  trackById(i: number, item: Project): string {
    return item.id;
  }
}
