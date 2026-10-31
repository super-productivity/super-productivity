import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule, NgModel } from '@angular/forms';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatDivider } from '@angular/material/divider';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatOption, MatSelect, MatSelectChange } from '@angular/material/select';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { BoardMatchMode, BoardPanelCfg } from '../../boards.model';
import { T } from '../../../../t.const';
import { TagEditComponent } from '../../../tag/tag-edit/tag-edit.component';
import { TagService } from '../../../tag/tag.service';
import { ProjectService } from '../../../project/project.service';
import { MenuTreeService } from '../../../menu-tree/menu-tree.service';
import { DEFAULT_PROJECT_ICON } from '../../../project/project.const';
import { SelectOptionRowComponent } from '../../../../ui/select-option-row/select-option-row.component';
import {
  getAddableRuleGroups,
  getRuleValue,
  getSortValue,
  isRuleSet,
  OTHER_VALUE,
  RuleValue,
  SelectRuleId,
  SORT_MANUAL,
  SORT_OPTIONS,
  VIEW_RULE_LABELS,
  VIEW_RULE_OPTIONS,
  VIEW_RULE_ORDER,
  ViewRuleId,
  withoutRule,
  withRuleAdded,
  withRuleValue,
  withSortValue,
} from '../view-editor.util';

/**
 * One section (List) or column (Board) of the view editor: its title, live
 * count and actions, the rules that are set (one row each) and its order.
 * Edits are emitted as a new panel; the panel's other fields stay as they are.
 */
@Component({
  selector: 'view-editor-section',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    MatFormField,
    MatLabel,
    MatError,
    MatInput,
    MatSelect,
    MatOption,
    MatIcon,
    MatIconButton,
    MatButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatDivider,
    MatTooltip,
    TranslatePipe,
    TagEditComponent,
    SelectOptionRowComponent,
  ],
  templateUrl: './view-editor-section.component.html',
  styleUrl: './view-editor-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewEditorSectionComponent {
  readonly panel = input.required<BoardPanelCfg>();
  /** Hidden for the only section of a list: nothing shows it. */
  readonly isShowTitle = input<boolean>(true);
  readonly isBoard = input<boolean>(false);
  readonly count = input<number>(0);
  readonly isFirst = input<boolean>(false);
  readonly isLast = input<boolean>(false);

  readonly panelChange = output<BoardPanelCfg>();
  readonly moveUp = output<void>();
  readonly moveDown = output<void>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();

  protected readonly T = T;
  protected readonly OTHER_VALUE = OTHER_VALUE;
  protected readonly RULE_LABELS = VIEW_RULE_LABELS;
  protected readonly RULE_OPTIONS = VIEW_RULE_OPTIONS;
  protected readonly SORT_OPTIONS = SORT_OPTIONS;
  protected readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  private readonly _injector = inject(Injector);
  private readonly _tagService = inject(TagService);
  private readonly _projectService = inject(ProjectService);
  private readonly _menuTreeService = inject(MenuTreeService);

  private readonly _titleModel = viewChild('titleModel', { read: NgModel });
  private readonly _titleInput = viewChild('titleModel', { read: MatInput });
  private readonly _projectSelect = viewChild<MatSelect>('projectSelect');
  // Required tags render before excluded ones.
  private readonly _tagEdits = viewChildren(TagEditComponent);

  // Rules added or edited here stay shown while their control is empty (an
  // empty project or tag list is no rule and saves as none). Local only.
  private readonly _touchedRules = signal<ReadonlySet<ViewRuleId>>(new Set());

  readonly shownRules = computed(() => {
    const panel = this.panel();
    const touched = this._touchedRules();
    return VIEW_RULE_ORDER.filter((rule) => touched.has(rule) || isRuleSet(panel, rule));
  });
  readonly addableRuleGroups = computed(() => getAddableRuleGroups(this.shownRules()));

  readonly projects = this._projectService.listInTreeOrder;
  readonly projectFolderMap = computed(() => this._menuTreeService.projectFolderMap());
  private readonly _projectIds = computed(
    () => new Set(this.projects().map((project) => project.id)),
  );
  private readonly _selectedProjectIds = computed(() =>
    (this.panel().projectIds ?? []).filter((id) => !!id),
  );
  /** The select shows known projects; ids of deleted ones are kept. */
  readonly knownProjectIds = computed(() =>
    this._selectedProjectIds().filter((id) => this._projectIds().has(id)),
  );
  readonly deletedProjectCount = computed(
    () => this._selectedProjectIds().length - this.knownProjectIds().length,
  );

  private readonly _tagIds = computed(
    () => new Set(this._tagService.tags().map((tag) => tag.id)),
  );
  // tag-edit hides ids without a tag (and keeps them on remove).
  readonly missingIncludedTagCount = computed(
    () => this.panel().includedTagIds.filter((id) => !this._tagIds().has(id)).length,
  );
  readonly missingExcludedTagCount = computed(
    () => this.panel().excludedTagIds.filter((id) => !this._tagIds().has(id)).length,
  );

  readonly sortValue = computed(() => getSortValue(this.panel()));
  readonly isSorted = computed(
    () => this.sortValue() !== SORT_MANUAL && this.sortValue() !== OTHER_VALUE,
  );
  readonly isSortDesc = computed(() => this.panel().sortDir === 'desc');

  /** The select value of each shown rule with a select. */
  readonly ruleValues = computed(() => {
    const panel = this.panel();
    const values: Partial<Record<ViewRuleId, RuleValue>> = {};
    for (const rule of this.shownRules()) {
      if (rule in VIEW_RULE_OPTIONS) {
        values[rule] = getRuleValue(panel, rule as SelectRuleId);
      }
    }
    return values;
  });

  setTitle(title: string): void {
    this._emit({ ...this.panel(), title });
  }

  addRule(rule: ViewRuleId): void {
    this._touch(rule);
    this._emit(withRuleAdded(this.panel(), rule));
    // Open or focus the new rule's control.
    afterNextRender(
      () => {
        if (rule === 'project') {
          this._projectSelect()?.open();
        } else if (rule === 'includedTags') {
          this._tagEdits()[0]?.focusInput();
        } else if (rule === 'excludedTags') {
          this._tagEdits().at(-1)?.focusInput();
        }
      },
      { injector: this._injector },
    );
  }

  removeRule(rule: ViewRuleId): void {
    const touched = new Set(this._touchedRules());
    touched.delete(rule);
    this._touchedRules.set(touched);
    this._emit(withoutRule(this.panel(), rule));
  }

  setRuleValue(rule: ViewRuleId, value: RuleValue): void {
    this._touch(rule);
    this._emit(withRuleValue(this.panel(), rule as SelectRuleId, value));
  }

  setProjects(ev: MatSelectChange): void {
    this._touch('project');
    const known = ev.value as string[];
    const deleted = this._selectedProjectIds().filter(
      (id) => !this._projectIds().has(id),
    );
    const projectIds = [...known, ...deleted];
    this._emit({ ...this.panel(), projectIds: projectIds.length ? projectIds : [''] });
  }

  setTags(rule: 'includedTags' | 'excludedTags', tagIds: string[]): void {
    this._touch(rule);
    this._emit(
      rule === 'includedTags'
        ? { ...this.panel(), includedTagIds: tagIds }
        : { ...this.panel(), excludedTagIds: tagIds },
    );
  }

  setTagsMatch(rule: 'includedTags' | 'excludedTags', match: BoardMatchMode): void {
    this._emit(
      rule === 'includedTags'
        ? { ...this.panel(), includedTagsMatch: match }
        : { ...this.panel(), excludedTagsMatch: match },
    );
  }

  setSort(value: string): void {
    this._emit(withSortValue(this.panel(), value));
  }

  toggleSortDir(): void {
    this._emit({ ...this.panel(), sortDir: this.isSortDesc() ? 'asc' : 'desc' });
  }

  /** Shows the title's error; whether it has one (a hidden title has none). */
  isTitleInvalid(): boolean {
    const model = this._titleModel();
    model?.control.markAsTouched();
    return !!model?.invalid;
  }

  focusTitle(): void {
    this._titleInput()?.focus();
  }

  private _touch(rule: ViewRuleId): void {
    if (!this._touchedRules().has(rule)) {
      this._touchedRules.set(new Set([...this._touchedRules(), rule]));
    }
  }

  private _emit(panel: BoardPanelCfg): void {
    this.panelChange.emit(panel);
  }
}
