import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { MatOption, MatSelect, MatSelectTrigger } from '@angular/material/select';

import { ProjectService } from '../../project/project.service';
import { GlobalConfigService } from '../global-config.service';
import { DefaultStartPage } from '../default-start-page.const';
import { T } from 'src/app/t.const';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';

@Component({
  selector: 'start-page-select',
  templateUrl: './start-page-select.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    FormlyModule,
    TranslatePipe,
    MatSelect,
    MatOption,
    MatSelectTrigger,
    SelectOptionRowComponent,
  ],
})
export class StartPageSelectComponent extends FieldType<FormlyFieldConfig> {
  private readonly _projectService = inject(ProjectService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  readonly T = T;
  readonly DefaultStartPage = DefaultStartPage;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  // Signal-based (CLAUDE.md prefers signals over observables).
  // listInTreeOrderForUI filters archived + hidden-from-menu projects.
  readonly projects = this._projectService.listInTreeOrderForUI;
  readonly appFeatures = this._globalConfigService.appFeatures;

  get selectedProjectTitle(): string | undefined {
    return this.projects().find((project) => project.id === this.formControl.value)
      ?.title;
  }
}
