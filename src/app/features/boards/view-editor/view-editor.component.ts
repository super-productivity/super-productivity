import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { MatButton } from '@angular/material/button';
import { MatButtonToggle, MatButtonToggleGroup } from '@angular/material/button-toggle';
import { MatDialogContent, MatDialogTitle } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { nanoid } from 'nanoid';
import { BoardCfg, BoardPanelCfg } from '../boards.model';
import { DEFAULT_PANEL_CFG } from '../boards.const';
import {
  getLayoutChanges,
  getPanelHeaderCount,
  normalizeBoardForSave,
  panelToCriteria,
  translateViewTitle,
  ViewLayout,
} from '../boards.util';
import { T } from '../../../t.const';
import { selectAllTasksInActiveProjects } from '../../tasks/store/task.selectors';
import { ViewCriteriaContextService } from '../view-criteria-context.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { TaskCopy } from '../../tasks/task.model';
import { TaskCriteriaCtx } from '../../tasks/task-criteria/task-criteria.model';
import { matchesTaskCriteria } from '../../tasks/task-criteria/task-criteria';
import { Project } from '../../project/project.model';
import { ViewEditorSectionComponent } from './view-editor-section/view-editor-section.component';
import { expandFadeFastAnimation } from '../../../ui/animations/expand.ani';
import { ViewEditorTitleComponent } from './view-editor-title/view-editor-title.component';
import {
  isSectionTitleShown,
  toEditorDisplayModel,
  toSavedBoard,
} from './view-editor.util';

interface CachedCount {
  tasks: readonly TaskCopy[];
  ctx: TaskCriteriaCtx;
  projects: readonly Project[];
  isListLayout: boolean;
  count: number;
  /** Per task object, for this panel, ctx and project list. */
  matches: WeakMap<TaskCopy, boolean>;
}

/**
 * Edits a view (board): its title, layout and sections or columns with their
 * rules. Works on a copy of the stored board; fields it doesn't show
 * (unknown values from newer clients, `taskIds`) are carried through, and an
 * untouched save stores `normalizeBoardForSave(toEditorModel(board))`.
 *
 * Renders the dialog's title (the view's name) and content; the dialog adds
 * the actions. Its host is `display: contents`, so both are the dialog's own
 * rows: the title stays put while the content scrolls.
 */
@Component({
  selector: 'view-editor',
  standalone: true,
  imports: [
    CdkDropList,
    CdkDrag,
    MatDialogTitle,
    MatDialogContent,
    MatButton,
    MatButtonToggle,
    MatButtonToggleGroup,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    ViewEditorSectionComponent,
    ViewEditorTitleComponent,
  ],
  templateUrl: './view-editor.component.html',
  styleUrl: './view-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The width picker comes and goes with the layout: the rows below slide.
  animations: [expandFadeFastAnimation],
})
export class ViewEditorComponent {
  /** The stored board (a new one has an id and no panels). */
  readonly board = input.required<BoardCfg>();
  /** A new view starts with one section. */
  readonly isNew = input<boolean>(false);
  /** The section shown open when the editor opens (default: the first). */
  readonly initialOpenPanelId = input<string | undefined>(undefined);
  /** Translation keys shown above the editor, e.g. what "Save as view" drops. */
  readonly hints = input<readonly string[]>([]);

  protected readonly T = T;

  private readonly _translateService = inject(TranslateService);
  private readonly _store = inject(Store);
  private readonly _viewCtx = inject(ViewCriteriaContextService);
  private readonly _injector = inject(Injector);
  readonly isXs = inject(LayoutService).isXs;
  /** The content is scrolled: the title, which stays, gets a bottom line. */
  readonly isScrolled = signal(false);

  onContentScroll(ev: Event): void {
    this.isScrolled.set((ev.target as HTMLElement).scrollTop > 0);
  }

  private readonly _nameField = viewChild.required(ViewEditorTitleComponent);
  private readonly _sections = viewChildren(ViewEditorSectionComponent);
  private readonly _sectionEls = viewChildren<
    ViewEditorSectionComponent,
    ElementRef<HTMLElement>
  >(ViewEditorSectionComponent, { read: ElementRef });

  // A title that happens to name a group of keys ("F", "G") stays as typed.
  private readonly _translate = (key: string): string =>
    translateViewTitle(key, (k) => this._translateService.instant(k));

  /** The editor model, titles as shown. */
  readonly model = linkedSignal<BoardCfg>(() => {
    const model = toEditorDisplayModel(this.board(), this._translate);
    return this.isNew() && !model.panels.length
      ? { ...model, panels: [this._newPanel()] }
      : model;
  });

  /**
   * The section cards that show their rules when there are several (any
   * number, each opened and closed on its own): when the editor opens, the
   * one asked for (a column's title) or the first; a new or duplicated one
   * once added. Kept by id when moving.
   */
  readonly openPanelIds = linkedSignal<
    { board: BoardCfg; initialId: string | undefined },
    ReadonlySet<string>
  >({
    source: () => ({ board: this.board(), initialId: this.initialOpenPanelId() }),
    computation: ({ board, initialId }) => {
      const id =
        initialId && board.panels.some((panel) => panel.id === initialId)
          ? initialId
          : board.panels[0]?.id;
      return new Set(id ? [id] : []);
    },
  });
  readonly isCollapsible = computed(() => this.model().panels.length > 1);
  /** Set after the first render: the editor opens as it is, then animates. */
  readonly isReady = signal(false);

  constructor() {
    // A column's title asked for its card: it can sit below the fold, behind
    // the collapsed cards before it. The first focus on its toggle
    // (`isFocusInitial`) would only bring the toggle itself into view.
    afterNextRender(() => {
      this.isReady.set(true);
      const id = this.initialOpenPanelId();
      const index = this.model().panels.findIndex((panel) => panel.id === id);
      if (index > 0) {
        this._sectionEls()[index]?.nativeElement.scrollIntoView({ block: 'start' });
      }
    });
  }

  readonly layout = computed<ViewLayout>(() =>
    this.model().cols > 1 ? 'board' : 'list',
  );
  readonly isBoard = computed(() => this.layout() === 'board');
  readonly isSectionTitleShown = computed(() => isSectionTitleShown(this.model()));
  /** The board widths to pick from, widest (one row) first; always the current. */
  readonly colsOptions = computed(() => {
    const { cols, panels } = this.model();
    const max = Math.max(2, cols, panels.length);
    return Array.from({ length: max - 1 }, (_, i) => max - i);
  });
  /** One box per section in each width's preview. */
  readonly previewBoxes = computed(() =>
    Array.from({ length: Math.max(1, this.model().panels.length) }),
  );

  // The live count runs the view's own matching on what would be saved, so it
  // is the number the section header will show for the chosen layout.
  private readonly _allTasks = this._store.selectSignal(selectAllTasksInActiveProjects);
  // Per editor panel object: typing a title or editing one section doesn't
  // match the other sections against every task again.
  private readonly _countCache = new WeakMap<BoardPanelCfg, CachedCount>();
  readonly counts = computed(() => {
    const model = this.model();
    const tasks = this._allTasks();
    const ctx = this._viewCtx.ctx();
    // Backlog membership is read while matching: a cached match follows it.
    const projects = this._viewCtx.projects();
    // Phones show every view as a list (`BoardComponent.isListLayout`).
    const isListLayout = model.cols <= 1 || this.isXs();
    return model.panels.map((panel) => {
      const hit = this._countCache.get(panel);
      const isSameMatching = !!hit && hit.ctx === ctx && hit.projects === projects;
      if (isSameMatching && hit.tasks === tasks && hit.isListLayout === isListLayout) {
        return hit.count;
      }
      // A tracking tick or one edited task replaces only that task object:
      // the others keep their match instead of being matched again.
      const matches = isSameMatching ? hit.matches : new WeakMap<TaskCopy, boolean>();
      const saved = normalizeBoardForSave({ ...model, panels: [panel] }).panels[0];
      const criteria = panelToCriteria(saved);
      const matching = tasks.filter((task) => {
        let isMatch = matches.get(task);
        if (isMatch === undefined) {
          isMatch = matchesTaskCriteria(task, criteria, ctx);
          matches.set(task, isMatch);
        }
        return isMatch;
      });
      const count = getPanelHeaderCount(matching, saved, isListLayout);
      this._countCache.set(panel, { tasks, ctx, projects, isListLayout, count, matches });
      return count;
    });
  });

  setTitle(title: string): void {
    this.model.update((model) => ({ ...model, title }));
  }

  /** Same change as the title bar's List/Board button (`setViewLayout`). */
  setLayout(layout: string | number): void {
    if (layout !== 'list' && layout !== 'board') {
      return;
    }
    this.model.update((model) => ({ ...model, ...getLayoutChanges(model, layout) }));
  }

  /** A board's columns per row: a whole number, 2 or more. */
  setCols(value: number): void {
    if (Number.isInteger(value) && value >= 2) {
      this.model.update((model) => ({ ...model, cols: value }));
    }
  }

  updatePanel(index: number, panel: BoardPanelCfg): void {
    this._setPanels(this.model().panels.map((p, i) => (i === index ? panel : p)));
  }

  /** Appends a section, open, its title field focused. */
  addPanel(): void {
    const panel = this._newPanel();
    // A list's only section was shown open, without a bar: it stays open.
    const only = this.isSectionTitleShown() ? undefined : this.model().panels[0];
    if (only) {
      this._open(only.id);
    }
    this._setPanels([...this._withHiddenTitleShown(), panel]);
    this._open(panel.id);
    afterNextRender(() => this._sections().at(-1)?.focusTitle(), {
      injector: this._injector,
    });
  }

  /** Opens or closes a section's card; others stay as they are. */
  togglePanel(id: string): void {
    this.openPanelIds.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  movePanel(index: number, offset: -1 | 1): void {
    this.movePanelTo(index, index + offset);
  }

  dropPanel(ev: CdkDragDrop<unknown>): void {
    this.movePanelTo(ev.previousIndex, ev.currentIndex);
  }

  movePanelTo(from: number, to: number): void {
    const panels = [...this.model().panels];
    if (from === to || to < 0 || to >= panels.length || !panels[from]) {
      return;
    }
    const [panel] = panels.splice(from, 1);
    panels.splice(to, 0, panel);
    this._setPanels(panels);
  }

  duplicatePanel(index: number): void {
    const panels = this._withHiddenTitleShown();
    const source = panels[index];
    const id = nanoid();
    panels.splice(index + 1, 0, {
      ...source,
      id,
      taskIds: [],
      title: `${source.title} (copy)`,
    });
    this._setPanels(panels);
    this._open(id);
  }

  removePanel(index: number): void {
    this._setPanels(this.model().panels.filter((_, i) => i !== index));
  }

  /**
   * The board to store, or null when a field is invalid: then every error
   * shows and the first invalid field gets the focus.
   */
  buildBoard(): BoardCfg | null {
    const name = this._nameField();
    const fields: { isInvalid: () => boolean; focus: () => void }[] = [
      { isInvalid: () => name.isInvalid(), focus: () => name.focus() },
      ...this._sections().map((section) => ({
        isInvalid: () => section.isTitleInvalid(),
        focus: () => section.focusTitle(),
      })),
    ];
    const invalid = fields.filter((field) => field.isInvalid());
    if (invalid.length) {
      invalid[0].focus();
      return null;
    }
    return toSavedBoard(this.model(), this.board(), this._translate);
  }

  /**
   * What saving without any change would store: the baseline for what the
   * user changed. It differs from the stored board where saving normalizes
   * (defaults filled in, a date rule's "scheduled"), which the user didn't do.
   */
  buildUntouchedBoard(): BoardCfg {
    return toSavedBoard(
      toEditorDisplayModel(this.board(), this._translate),
      this.board(),
      this._translate,
    );
  }

  /**
   * The panels, with the hidden title of a list's only section filled in as
   * save would (the view's title, unless it has its own), since it shows once
   * there is a second section.
   */
  private _withHiddenTitleShown(): BoardPanelCfg[] {
    const model = this.model();
    const [only, ...rest] = model.panels;
    if (!only || rest.length || this.isSectionTitleShown()) {
      return [...model.panels];
    }
    const storedTitle = this.board().title;
    const isFollowing =
      !only.title || (!!storedTitle && only.title === this._translate(storedTitle));
    return [isFollowing ? { ...only, title: model.title } : only];
  }

  private _open(id: string): void {
    this.openPanelIds.update((ids) => new Set([...ids, id]));
  }

  /**
   * A board in one row stays one row as sections come and go; a wrapped one
   * (a 2×2) keeps its width.
   */
  private _setPanels(panels: BoardPanelCfg[]): void {
    this.model.update((model) => {
      const isOneRow = model.cols > 1 && model.cols >= model.panels.length;
      const cols = isOneRow ? Math.max(2, panels.length) : model.cols;
      return { ...model, panels, cols };
    });
  }

  private _newPanel(): BoardPanelCfg {
    return { ...DEFAULT_PANEL_CFG, id: nanoid() };
  }
}
