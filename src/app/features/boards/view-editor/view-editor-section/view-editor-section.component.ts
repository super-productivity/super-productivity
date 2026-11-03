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
import { expandFadeFastAnimation } from '../../../../ui/animations/expand.ani';
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

/** How a section shows (`mode`). */
type SectionMode = 'card' | 'flat';

/**
 * One section (List) or column (Board) of the view editor. As a card (when
 * titles show): drag handle, title, count and, open, its rules as chips and
 * its sort; collapsed, a summary of its rules. The only section of a list
 * shows the rules without a card (`flat`). Phones show the same cards.
 * Edits are emitted as a new panel; the panel's other fields stay as they
 * are.
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
  // One timing for enter and leave: the summary and the rules swap, and their
  // heights only sum to a steady grow or shrink when they ease alike.
  animations: [expandFadeFastAnimation],
})
export class ViewEditorSectionComponent {
  readonly panel = input.required<BoardPanelCfg>();
  /** Hidden for the only section of a list: no card, no title. */
  readonly isShowTitle = input<boolean>(true);
  readonly isBoard = input<boolean>(false);
  /** Its position (0-based), shown as its number. */
  readonly index = input<number>(0);
  readonly count = input<number>(0);
  /** How many sections the view has ("Section 2 of 3"). */
  readonly total = input<number>(1);
  readonly isFirst = input<boolean>(false);
  readonly isLast = input<boolean>(false);
  /** With several sections each opens and closes; closed, a summary. */
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
  private readonly _chips = viewChildren(ViewRuleChipComponent);

  // Rules added or edited here stay shown while their control is empty (an
  // empty project or tag list is no rule and saves as none). Local only.
  private readonly _touchedRules = signal<ReadonlySet<ViewRuleId>>(new Set());
  /** Set after the first render: a card shows as it is, then animates. */
  readonly isReady = signal(false);

  constructor() {
    afterNextRender(() => this.isReady.set(true));
  }

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

  readonly mode = computed<SectionMode>(() => (this.isShowTitle() ? 'card' : 'flat'));
  readonly isCollapsed = computed(
    () => this.mode() === 'card' && this.isCollapsible() && !this.isOpen(),
  );
  readonly countLabel = computed(() => getCountLabel(this.count(), this.panel()));
  readonly groupLabel = computed(() =>
    this.isBoard() ? T.F.BOARDS.EDITOR.COLUMN_NR : T.F.BOARDS.EDITOR.SECTION_NR,
  );
  readonly titleLabel = computed(() =>
    this.isBoard() ? T.F.BOARDS.EDITOR.COLUMN_TITLE : T.F.BOARDS.EDITOR.SECTION_TITLE,
  );

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
  /** The summary of a collapsed card: the set rules only. */
  readonly summaryParts = computed(() =>
    this.isCollapsed() ? this._toShown(getSetRules(this.panel())) : [],
  );

  setTitle(title: string): void {
    this._emit({ ...this.panel(), title });
  }

  /** Opens or closes the card in place. */
  openRules(): void {
    this.toggleOpen.emit();
  }

  /** A click on the card's bar, not on one of its controls, toggles it. */
  onHeaderClick(ev: MouseEvent): void {
    const target = ev.target;
    if (
      !this.isCollapsible() ||
      !(target instanceof Element) ||
      target.closest('button, input')
    ) {
      return;
    }
    this.openRules();
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

  /**
   * Shows the title's error; whether it has one. A hidden title has none, nor
   * a collapsed card's (it shows as text only when set).
   */
  isTitleInvalid(): boolean {
    return this._title()?.isInvalid() ?? false;
  }

  /** Renames: the title's field, focused (a collapsed card opens first). */
  focusTitle(): void {
    if (this.isCollapsed() && !this._title()) {
      this.toggleOpen.emit();
      afterNextRender(() => this._title()?.focus(), { injector: this._injector });
      return;
    }
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
