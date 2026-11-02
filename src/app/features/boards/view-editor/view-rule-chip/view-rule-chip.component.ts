import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MatDivider } from '@angular/material/divider';
import { MatFormField } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { BoardMatchMode, BoardPanelCfg } from '../../boards.model';
import { T } from '../../../../t.const';
import { TagService } from '../../../tag/tag.service';
import { TODAY_TAG } from '../../../tag/tag.const';
import { ProjectService } from '../../../project/project.service';
import { MenuTreeService } from '../../../menu-tree/menu-tree.service';
import { DEFAULT_PROJECT_ICON } from '../../../project/project.const';
import { TagComponentTag } from '../../../tag/tag/tag.component';
import { SelectOptionRowComponent } from '../../../../ui/select-option-row/select-option-row.component';
import { ViewRuleValueComponent } from '../view-rule-value/view-rule-value.component';
import { isTouchActive } from '../../../../util/input-intent';
import {
  getRuleValue,
  getTagsMatch,
  OTHER_VALUE,
  RulePart,
  RuleValue,
  SelectRuleId,
  TAGS_MATCH_OPTIONS,
  TagRuleId,
  VIEW_RULE_OPTIONS,
  withIdToggled,
  withProjectToggled,
  withRuleValue,
} from '../view-editor.util';

type ChipKind = 'select' | 'tags' | 'project' | 'flag';

/** From this many projects on, their menu gets a filter field. */
const PROJECT_FILTER_MIN = 9;

/** As tag-edit creates tags: without the short-syntax `#`. */
const toNewTagTitle = (text: string): string => text.replace('#', '').trim();

const byTitle = <R>(rows: R[], text: string, title: (row: R) => string): R[] => {
  const query = text.trim().toLowerCase();
  return query ? rows.filter((row) => title(row).toLowerCase().includes(query)) : rows;
};

/**
 * One rule of an open section as a chip: `Label: value` opens a menu with
 * the rule's controls (options, tags or projects), × removes the rule.
 * Flags ("Without tags", "Only parent tasks") have no menu.
 */
@Component({
  selector: 'view-rule-chip',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MatIcon,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    MatDivider,
    MatFormField,
    MatInput,
    TranslatePipe,
    SelectOptionRowComponent,
    ViewRuleValueComponent,
  ],
  templateUrl: './view-rule-chip.component.html',
  styleUrl: '../view-editor-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  host: { '[attr.data-rule]': 'part().rule' },
})
export class ViewRuleChipComponent {
  readonly part = input.required<RulePart>();
  readonly panel = input.required<BoardPanelCfg>();
  /** The tags (or, for the project rule, projects) by id, for the value. */
  readonly items = input<ReadonlyMap<string, TagComponentTag>>(new Map());

  readonly panelChange = output<BoardPanelCfg>();
  readonly remove = output<void>();

  protected readonly T = T;
  protected readonly OTHER_VALUE = OTHER_VALUE;
  protected readonly DEFAULT_PROJECT_ICON = DEFAULT_PROJECT_ICON;

  private readonly _tagService = inject(TagService);
  private readonly _projectService = inject(ProjectService);
  private readonly _menuTreeService = inject(MenuTreeService);
  private readonly _injector = inject(Injector);
  private readonly _trigger = viewChild(MatMenuTrigger);
  private readonly _menu = viewChild(MatMenu);
  private readonly _filterInput = viewChild('filterInput', { read: ElementRef });

  /** The tag or project menu's filter text; cleared whenever the menu opens. */
  readonly filter = signal('');

  readonly kind = computed<ChipKind>(() => {
    const rule = this.part().rule;
    if (rule in VIEW_RULE_OPTIONS) return 'select';
    if (rule === 'includedTags' || rule === 'excludedTags') return 'tags';
    return rule === 'project' ? 'project' : 'flag';
  });

  // Select rules
  readonly options = computed(
    () => VIEW_RULE_OPTIONS[this.part().rule as SelectRuleId] ?? [],
  );
  readonly value = computed(() =>
    this.kind() === 'select'
      ? getRuleValue(this.panel(), this.part().rule as SelectRuleId)
      : null,
  );

  // Tag rules: the other tag rule's tags can't be picked here too.
  private readonly _tagRule = computed(() => this.part().rule as TagRuleId);
  private readonly _tagIds = computed(() =>
    this._tagRule() === 'includedTags'
      ? this.panel().includedTagIds
      : this.panel().excludedTagIds,
  );
  readonly tagRows = computed(() => {
    if (this.kind() !== 'tags') return [];
    const selected = new Set(this._tagIds());
    const other = new Set(
      this._tagRule() === 'includedTags'
        ? this.panel().excludedTagIds
        : this.panel().includedTagIds,
    );
    // Today is virtual (never in `task.tagIds`): as in tag-edit, not offered.
    const tags = byTitle(
      this._tagService.tagsInTreeOrder().filter((tag) => tag.id !== TODAY_TAG.id),
      this.filter(),
      (t) => t.title,
    );
    return tags.map((tag) => ({
      tag,
      color: tag.color || tag.theme?.primary,
      isSelected: selected.has(tag.id),
      isDisabled: other.has(tag.id),
    }));
  });
  /** The title "Create tag" would create: the filter, unless a tag has it. */
  readonly newTagTitle = computed(() => {
    if (this.kind() !== 'tags') return '';
    const title = toNewTagTitle(this.filter());
    const lower = title.toLowerCase();
    const isTaken = this._tagService
      .tags()
      .some((tag) => tag.title.trim().toLowerCase() === lower);
    return title && !isTaken ? title : '';
  });
  readonly matchOptions = computed(() =>
    this.kind() === 'tags' ? TAGS_MATCH_OPTIONS[this._tagRule()] : [],
  );
  readonly match = computed(() =>
    this.kind() === 'tags' ? getTagsMatch(this.panel(), this._tagRule()) : null,
  );

  // Project rule
  readonly isProjectFilterShown = computed(
    () =>
      this.kind() === 'project' &&
      this._projectService.listInTreeOrder().length >= PROJECT_FILTER_MIN,
  );
  readonly projectRows = computed(() => {
    if (this.kind() !== 'project') return [];
    const selected = new Set(this.panel().projectIds ?? []);
    const folders = this._menuTreeService.projectFolderMap();
    const projects = byTitle(
      this._projectService.listInTreeOrder(),
      this.filter(),
      (p) => p.title,
    );
    return projects.map((project) => ({
      project,
      folderPath: folders.get(project.id),
      isSelected: selected.has(project.id),
    }));
  });

  openMenu(): void {
    this._trigger()?.openMenu();
  }

  /**
   * Starts with an empty filter, focused for typing. Not on touch: it would
   * raise the on-screen keyboard over the list (as dialogs don't,
   * `dialog-auto-focus.ts`).
   */
  onMenuOpened(): void {
    this.filter.set('');
    if (!isTouchActive()) {
      // After the menu focuses its first item.
      afterNextRender(() => this._filterInput()?.nativeElement.focus(), {
        injector: this._injector,
      });
    }
  }

  setFilter(ev: Event): void {
    this.filter.set((ev.target as HTMLInputElement).value);
  }

  /**
   * Keeps typing in the field: the menu would take letters as typeahead and
   * Space/Home/End as navigation. ArrowDown moves to the list; Enter creates
   * the tag the filter names. Escape and Tab still close the menu.
   */
  onFilterKeydown(ev: KeyboardEvent): void {
    if (ev.isComposing || ev.keyCode === 229) {
      ev.stopPropagation();
      return;
    }
    if (ev.key === 'Escape' || ev.key === 'Tab') {
      return;
    }
    ev.stopPropagation();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this._menu()?.focusFirstItem('keyboard');
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (this.newTagTitle()) {
        this.createTag();
      }
    }
  }

  /** Creates a tag from the filter text (as tag-edit does) and picks it. */
  createTag(): void {
    const title = this.newTagTitle();
    if (!title) {
      return;
    }
    const id = this._tagService.addTag({ title });
    this.filter.set('');
    if (!this._tagIds().includes(id)) {
      this.toggleTag(id);
    }
  }

  setValue(value: RuleValue): void {
    this.panelChange.emit(
      withRuleValue(this.panel(), this.part().rule as SelectRuleId, value),
    );
  }

  toggleTag(id: string): void {
    const tagIds = withIdToggled(this._tagIds(), id);
    this.panelChange.emit(
      this._tagRule() === 'includedTags'
        ? { ...this.panel(), includedTagIds: tagIds }
        : { ...this.panel(), excludedTagIds: tagIds },
    );
  }

  setMatch(match: RuleValue): void {
    const mode = match as BoardMatchMode;
    this.panelChange.emit(
      this._tagRule() === 'includedTags'
        ? { ...this.panel(), includedTagsMatch: mode }
        : { ...this.panel(), excludedTagsMatch: mode },
    );
  }

  toggleProject(id: string): void {
    this.panelChange.emit(withProjectToggled(this.panel(), id));
  }
}
