import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatOption, MatSelect } from '@angular/material/select';

import { ProjectService } from '../../project/project.service';
import { GlobalConfigService } from '../global-config.service';
import { DefaultStartPage, toViewStartPage } from '../default-start-page.const';
import { T } from 'src/app/t.const';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import { DEFAULT_PROJECT_ICON, INBOX_PROJECT } from '../../project/project.const';
import { BoardsService } from '../../boards/boards.service';
import { getViewIcon, translateViewTitle } from '../../boards/boards.util';

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
    SelectOptionRowComponent,
  ],
})
export class StartPageSelectComponent extends FieldType<FormlyFieldConfig> {
  private readonly _projectService = inject(ProjectService);
  private readonly _globalConfigService = inject(GlobalConfigService);
  private readonly _boardsService = inject(BoardsService);
  private readonly _translateService = inject(TranslateService);

  readonly T = T;
  readonly DefaultStartPage = DefaultStartPage;
  readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;
  readonly inboxProjectId = INBOX_PROJECT.id;

  readonly inboxProject = computed(() =>
    this._projectService
      .listInTreeOrderForUI()
      .find((project) => project.id === this.inboxProjectId),
  );
  readonly inboxCustomTitle = computed(() => {
    const title = this.inboxProject()?.title;
    return title === INBOX_PROJECT.title ? undefined : title;
  });
  readonly projects = computed(() =>
    this._projectService
      .listInTreeOrderForUI()
      .filter((project) => project.id !== this.inboxProjectId),
  );
  readonly appFeatures = this._globalConfigService.appFeatures;
  readonly views = computed(() =>
    this._boardsService.boards().map((view) => ({
      value: toViewStartPage(view.id),
      title: translateViewTitle(view.title, (key) => this._translateService.instant(key)),
      icon: getViewIcon(view),
    })),
  );
}
