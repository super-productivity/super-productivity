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
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { BoardPanelCfg, BoardPanelCfgTaskDoneState } from '../../boards.model';
import { T } from '../../../../t.const';
import { TagService } from '../../../tag/tag.service';
import { ProjectService } from '../../../project/project.service';
import { DEFAULT_PROJECT_ICON } from '../../../project/project.const';
import { TagComponentTag } from '../../../tag/tag/tag.component';
import { ViewEditorTitleComponent } from '../view-editor-title/view-editor-title.component';
import { ViewRuleValueComponent } from '../view-rule-value/view-rule-value.component';
import { ViewRuleChipComponent } from '../view-rule-chip/view-rule-chip.component';
import { ViewSortChipComponent } from '../view-sort-chip/view-sort-chip.component';
import { ViewAddRuleChipComponent } from '../view-add-rule-chip/view-add-rule-chip.component';
import {
  getCountLabel,
  getRuleParts,
  getSetRules,
  isRuleSet,
  RuleKnownIds,
  RulePart,
  VIEW_RULE_ORDER,
  ViewRuleId,
  withoutRule,
  withRuleAdded,
} from '../view-editor.util';

let nextSectionId = 0;

/** Rules that start empty when added: their chip's menu opens to fill them. */
const EMPTY_ADDED_RULES: ReadonlySet<ViewRuleId> = new Set([
  'project',
  'includedTags',
  'excludedTags',
]);

interface ShownPart {
  part: RulePart;
  items: ReadonlyMap<string, TagComponentTag>;
}

/**
 * One section (List) or column (Board) of the view editor. As a card (when
 * titles show): number, drag handle, title, count and, open, its rules as
 * chips, its sort and a preview of the matching tasks; collapsed, a summary
 * of its rules. The only section of a list shows the rules without a card.
 * Edits are emitted as a new panel; the panel's other fields stay as they are.
 */
@Component({
  selector: 'view-editor-section',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    CdkDragHandle,
    MatIcon,
    MatIconButton,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    MatTooltip,
    TranslatePipe,
    ViewEditorTitleComponent,
    ViewRuleValueComponent,
    ViewRuleChipComponent,
    ViewSortChipComponent,
    ViewAddRuleChipComponent,
  ],
  templateUrl: './view-editor-section.component.html',
  styleUrl: './view-editor-section.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewEditorSectionComponent {
  readonly panel = input.required<BoardPanelCfg>();
  /** Hidden for the only section of a list: no card, no title. */
  readonly isShowTitle = input<boolean>(true);
  readonly isBoard = input<boolean>(false);
  /** Its position (0-based), shown as its number. */
  readonly index = input<number>(0);
  readonly count = input<number>(0);
  /** The titles of its first matching tasks (open sections preview them). */
  readonly previewTitles = input<readonly string[]>([]);
  readonly isFirst = input<boolean>(false);
  readonly isLast = input<boolean>(false);
  /** With several sections one is open; the others show a summary. */
  readonly isCollapsible = input<boolean>(false);
  readonly isOpen = input<boolean>(true);
  /**
   * The card a column's title asked for: the dialog's first focus goes to its
   * title (`cdkFocusInitial`) instead of the view's.
   */
  readonly isFocusInitial = input<boolean>(false);

  readonly panelChange = output<BoardPanelCfg>();
  readonly moveUp = output<void>();
  readonly moveDown = output<void>();
  readonly duplicate = output<void>();
  readonly remove = output<void>();
  readonly toggleOpen = output<void>();

  protected readonly T = T;
  protected readonly bodyId = `view-section-body-${nextSectionId++}`;

  private readonly _injector = inject(Injector);
  private readonly _tagService = inject(TagService);
  private readonly _projectService = inject(ProjectService);

  private readonly _title = viewChild(ViewEditorTitleComponent);
  private readonly _actions = viewChild('sectionActions', {
    read: ElementRef<HTMLButtonElement>,
  });
  private readonly _chips = viewChildren(ViewRuleChipComponent);

  // Rules added or edited here stay shown while their control is empty (an
  // empty project or tag list is no rule and saves as none). Local only.
  private readonly _touchedRules = signal<ReadonlySet<ViewRuleId>>(new Set());

  readonly shownRules = computed(() => {
    const panel = this.panel();
    const touched = this._touchedRules();
    return VIEW_RULE_ORDER.filter((rule) => touched.has(rule) || isRuleSet(panel, rule));
  });

  /** Checking off a task doesn't apply a Done section's tag rules (#11418). */
  readonly isShowDoneTagHint = computed(() => {
    const panel = this.panel();
    return (
      panel.taskDoneState === BoardPanelCfgTaskDoneState.Done &&
      !!(panel.includedTagIds.length || panel.excludedTagIds.length)
    );
  });

  readonly isCollapsed = computed(() => this.isCollapsible() && !this.isOpen());
  readonly countLabel = computed(() => getCountLabel(this.count(), this.panel()));
  readonly moreCount = computed(() => this.count() - this.previewTitles().length);

  private readonly _tagsById = computed(
    () =>
      new Map<string, TagComponentTag>(
        this._tagService.tags().map((tag) => [
          tag.id,
          {
            title: tag.title,
            icon: tag.icon || undefined,
            color: tag.color || tag.theme?.primary || undefined,
          },
        ]),
      ),
  );
  private readonly _projectsById = computed(
    () =>
      new Map<string, TagComponentTag>(
        this._projectService.listInTreeOrder().map((project) => [
          project.id,
          {
            title: project.title,
            icon: project.icon || DEFAULT_PROJECT_ICON,
            color: project.theme?.primary || undefined,
          },
        ]),
      ),
  );
  private readonly _known = computed<RuleKnownIds>(() => ({
    projects: new Set(this._projectsById().keys()),
    tags: new Set(this._tagsById().keys()),
  }));

  /** The open section's chips: every shown rule, empty added ones too. */
  readonly parts = computed(() => this._toShown(this.shownRules()));
  /** The collapsed section's summary: the set rules only. */
  readonly summaryParts = computed(() =>
    this.isCollapsed() ? this._toShown(getSetRules(this.panel())) : [],
  );

  setTitle(title: string): void {
    this._emit({ ...this.panel(), title });
  }

  openRules(): void {
    this.toggleOpen.emit();
    // Opening replaces the chevron. Keep keyboard focus on its replacement.
    afterNextRender(() => this._actions()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }

  addRule(rule: ViewRuleId): void {
    this._touch(rule);
    this._emit(withRuleAdded(this.panel(), rule));
    if (EMPTY_ADDED_RULES.has(rule)) {
      afterNextRender(
        () =>
          this._chips()
            .find((chip) => chip.part().rule === rule)
            ?.openMenu(),
        { injector: this._injector },
      );
    }
  }

  removeRule(rule: ViewRuleId): void {
    const touched = new Set(this._touchedRules());
    touched.delete(rule);
    this._touchedRules.set(touched);
    this._emit(withoutRule(this.panel(), rule));
  }

  /** A chip's edit of its rule. */
  setRule(rule: ViewRuleId, panel: BoardPanelCfg): void {
    this._touch(rule);
    this._emit(panel);
  }

  setPanel(panel: BoardPanelCfg): void {
    this._emit(panel);
  }

  /** Shows the title's error; whether it has one (a hidden title has none). */
  isTitleInvalid(): boolean {
    return !!this._title()?.isInvalid();
  }

  /** Renames: the title's field, focused. */
  focusTitle(): void {
    this._title()?.focus();
  }

  private _toShown(rules: readonly ViewRuleId[]): ShownPart[] {
    return getRuleParts(this.panel(), rules, this._known()).map((part) => ({
      part,
      items: part.rule === 'project' ? this._projectsById() : this._tagsById(),
    }));
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
