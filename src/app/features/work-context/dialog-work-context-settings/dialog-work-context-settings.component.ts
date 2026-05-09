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
import { DEFAULT_TAG_COLOR } from '../work-context.const';
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
  // Track whether the user explicitly customized theme.primary at any
  // point; before that, tag.color edits should mirror to theme.primary
  // so the dialog stays visually aligned with what the chip renders.
  private _userTouchedThemePrimary: boolean;
  // Track whether the user actually edited tag.color in the form. The
  // dialog can prefill tag.color visually (e.g. from theme.primary on a
  // legacy tag with no color); if the user never touches it, we must
  // not persist that prefill back to the store.
  private _userTouchedTagColor = false;

  constructor() {
    const entity = this._data.entity;
    const theme = { ...entity.theme };
    let tagColor: string | null | undefined;
    // For tags: align the displayed Tag Color and Primary fields with
    // the tag's actually rendered color. If one is missing or still at
    // the inherited default, fill it with the other so both inputs show
    // the same hue when the form opens.
    if (!this._data.isProject) {
      const tag = entity as Tag;
      tagColor = tag.color;
      if (tag.color && theme.primary === DEFAULT_TAG_COLOR) {
        theme.primary = tag.color;
      } else if (!tag.color && theme.primary) {
        tagColor = theme.primary;
      }
    }
    this.entityData = {
      ...entity,
      ...(this._data.isProject ? {} : { color: tagColor }),
      theme,
    } as Project | Tag;
    // Snapshot the *pre-prefill* entity so cancelling restores the
    // original store state instead of pushing the prefilled values.
    this._originalEntityData = {
      ...entity,
      theme: { ...entity.theme },
    } as Project | Tag;
    // If the user opens settings on a tag whose stored theme.primary
    // matches the auto-default (or has just been prefilled to tag.color),
    // treat it as "not yet customized" so live tag.color edits keep
    // theme.primary in sync.
    this._userTouchedThemePrimary = this._data.isProject
      ? false
      : entity.theme?.primary !== DEFAULT_TAG_COLOR &&
        entity.theme?.primary !== (entity as Tag).color;
    this.fields = adjustToLiveFormlyForm(
      buildWorkContextSettingsFormCfg(this._data.isProject),
    );
  }

  onModelChange(model: Project | Tag): void {
    let next: Project | Tag = model;
    if (!this._data.isProject) {
      const tag = model as Tag;
      const prevColor = (this.entityData as Tag).color;
      const prevPrimary = this.entityData.theme?.primary;
      const nextPrimary = tag.theme?.primary;
      if (tag.color !== prevColor) {
        this._userTouchedTagColor = true;
      }
      // Detect explicit Primary edits so we stop auto-mirroring.
      if (nextPrimary !== prevPrimary && nextPrimary !== tag.color) {
        this._userTouchedThemePrimary = true;
      }
      // Mirror tag.color into Primary while the user hasn't explicitly
      // chosen a different Primary. Otherwise the dialog shows a stale
      // Primary value that doesn't match the actually rendered color.
      if (!this._userTouchedThemePrimary && tag.color && tag.color !== nextPrimary) {
        // Update the FormControl so the Primary input re-renders with
        // the mirrored value. emitEvent: false avoids re-triggering this
        // listener and looping.
        this.form.get('theme.primary')?.setValue(tag.color, { emitEvent: false });
        next = {
          ...tag,
          theme: { ...tag.theme, primary: tag.color },
        } as Tag;
      }
    }
    this.entityData = next;
    if (this.form.valid && next.title?.trim()) {
      this._applyChanges(next);
    }
  }

  done(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
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
      const orig = this._originalEntityData as Tag;
      // Only persist values the user actually edited. The dialog may
      // have prefilled tag.color or theme.primary purely for display;
      // those prefills must not leak back to the store on save.
      // theme.primary follows tag.color edits via the live mirror, so a
      // tag.color change implies the mirrored primary should also be
      // persisted.
      const persistColor = this._userTouchedTagColor;
      const persistPrimary = this._userTouchedThemePrimary || this._userTouchedTagColor;
      this._tagService.updateTag(t.id, {
        title: t.title,
        icon: t.icon,
        color: persistColor ? t.color : orig.color,
        theme: persistPrimary ? theme : { ...theme, primary: orig.theme?.primary },
      });
    }
  }
}
