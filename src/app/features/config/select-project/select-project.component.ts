import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FieldType } from '@ngx-formly/material';
import { ProjectService } from '../../project/project.service';
import { Project } from '../../project/project.model';
import { T } from 'src/app/t.const';
import { FormlyFieldConfig, FormlyFieldProps, FormlyModule } from '@ngx-formly/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  MatOption,
  MatSelect,
  MatSelectChange,
  MatSelectTrigger,
} from '@angular/material/select';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { unique } from '../../../util/unique';
import { fastArrayCompare } from '../../../util/fast-array-compare';
import { startWith } from 'rxjs/operators';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { SelectOptionRowComponent } from '../../../ui/select-option-row/select-option-row.component';
import { DEFAULT_PROJECT_ICON } from '../../project/project.const';

/** Custom props for the shared `project-select` formly field. */
export interface SelectProjectProps extends FormlyFieldProps {
  /** Label for the default (`''`) option; defaults to the translated "None". */
  defaultLabel?: string;
  /** Hide the default option entirely (e.g. the tasks default-project field, #7891). */
  hideNoneOption?: boolean;
  /** Allow multiple selection. */
  multiple?: boolean;
}

@Component({
  selector: 'select-project',
  templateUrl: './select-project.component.html',
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
    MatSelectTrigger,
    SelectOptionRowComponent,
  ],
})
export class SelectProjectComponent
  extends FieldType<FormlyFieldConfig<SelectProjectProps>>
  implements OnInit
{
  projectService = inject(ProjectService);
  _translateService = inject(TranslateService);
  _destroyRef = inject(DestroyRef);
  _menuTreeService = inject(MenuTreeService);
  projects = toSignal(this.projectService.listInTreeOrder$, { initialValue: [] });

  T: typeof T = T;
  DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;
  private _prevValue: string[] = [];

  // Use a manual signal to bridge formControl.valueChanges
  val = signal<string[]>([]);

  triggerLabel = computed(() => {
    const val = this.val();
    if (this.to.multiple && Array.isArray(val)) {
      if (val.includes('')) {
        return this.to.defaultLabel
          ? this._translateService.instant(this.to.defaultLabel)
          : this._translateService.instant(T.G.NONE);
      }
      if (val.length > 0) {
        const projects = this.projects();
        return val
          .map((id) => projects.find((p) => p.id === id)?.title)
          .filter((v) => !!v)
          .join(', ');
      }
    }
    return null;
  });

  projectFolderMap = computed(() => this._menuTreeService.projectFolderMap());

  constructor() {
    super();
    effect(() => {
      const projects = this.projects();
      // Only run when initialized and for multiple selection
      if (this.to.multiple && projects.length > 0 && this.formControl) {
        const val = this.formControl.value;
        if (Array.isArray(val) && val.includes('')) {
          const allIds = projects.map((p) => p.id);
          const newValue = unique(['', ...allIds]);
          if (!fastArrayCompare(val, newValue)) {
            this.formControl.setValue(newValue);
            this._prevValue = newValue;
          }
        } else if (Array.isArray(val)) {
          this._prevValue = val;
        }
      }
    });
  }

  ngOnInit(): void {
    if (this.formControl) {
      this.formControl.valueChanges
        .pipe(startWith(this.formControl.value), takeUntilDestroyed(this._destroyRef))
        .subscribe((v) => this.val.set(v));
    }
  }

  get type(): string {
    return this.to.type || 'text';
  }

  trackById(i: number, item: Project): string {
    return item.id;
  }

  onSelectionChange(ev: MatSelectChange): void {
    if (!this.to.multiple) {
      return;
    }

    const value = ev.value as string[];
    const allIds = this.projects().map((p) => p.id);
    const wasAllSelected = this._prevValue.includes('');
    const isAllSelectedNow = value.includes('');

    let newValue: string[];

    if (isAllSelectedNow && !wasAllSelected) {
      // "All Projects" was just checked -> Select EVERYTHING
      newValue = ['', ...allIds];
    } else if (!isAllSelectedNow && wasAllSelected) {
      // "All Projects" was just unchecked -> Select NOTHING
      newValue = [];
    } else {
      // Individual project toggled
      const projectsOnly = value.filter((v) => v !== '');
      if (projectsOnly.length === allIds.length) {
        // All projects selected manually -> Add "All Projects"
        newValue = ['', ...allIds];
      } else {
        // Not all projects selected -> Remove "All Projects"
        newValue = projectsOnly;
      }
    }

    this._prevValue = newValue;
    this.formControl.setValue(newValue);
  }
}
