import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { T } from '../../../t.const';
import { Project } from '../../project/project.model';
import { Tag } from '../../tag/tag.model';
import { WorkContextThemeCfg } from '../work-context.model';
import { ProjectService } from '../../project/project.service';
import { TagService } from '../../tag/tag.service';
import { buildWorkContextSettingsFormCfg } from './work-context-settings-form-cfg.const';
import { adjustToLiveFormlyForm } from '../../../util/adjust-to-live-formly-form';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';

export interface WorkContextSettingsDialogData {
  isProject: boolean;
  entity: Project | Tag;
}

@Component({
  selector: 'dialog-work-context-settings',
  templateUrl: './dialog-work-context-settings.component.html',
  styleUrls: ['./dialog-work-context-settings.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogTitle,
    ReactiveFormsModule,
    MatDialogContent,
    FormlyModule,
    MatDialogActions,
    MatButton,
    TranslatePipe,
  ],
})
export class DialogWorkContextSettingsComponent {
  private _data = inject<WorkContextSettingsDialogData>(MAT_DIALOG_DATA);
  private _projectService = inject(ProjectService);
  private _tagService = inject(TagService);
  private _matDialogRef =
    inject<MatDialogRef<DialogWorkContextSettingsComponent>>(MatDialogRef);

  T: typeof T = T;
  isProject: boolean = this._data.isProject;
  entityData: Project | Tag;
  form: UntypedFormGroup = new UntypedFormGroup({});
  fields: FormlyFieldConfig[];

  private _originalEntityData: Project | Tag;

  constructor() {
    const entity = this._data.entity;
    this.entityData = {
      ...entity,
      theme: { ...entity.theme },
    } as Project | Tag;
    this._originalEntityData = {
      ...entity,
      theme: { ...entity.theme },
    } as Project | Tag;
    this.fields = adjustToLiveFormlyForm(
      buildWorkContextSettingsFormCfg(this._data.isProject),
    );
  }

  onModelChange(model: Project | Tag): void {
    this.entityData = model;
    if (this.form.valid) {
      this._applyChanges(model);
    }
  }

  done(): void {
    this._matDialogRef.close();
  }

  cancelEdit(): void {
    this._applyChanges(this._originalEntityData);
    this._matDialogRef.close();
  }

  private _applyChanges(data: Project | Tag): void {
    const theme: WorkContextThemeCfg = { ...data.theme };
    if (this.isProject) {
      const p = data as Project;
      this._projectService.update(p.id, {
        title: p.title,
        icon: p.icon,
        isEnableBacklog: p.isEnableBacklog,
        isHiddenFromMenu: p.isHiddenFromMenu,
        theme,
      });
    } else {
      const t = data as Tag;
      this._tagService.updateTag(t.id, {
        title: t.title,
        icon: t.icon,
        color: t.color,
        theme,
      });
    }
  }
}
