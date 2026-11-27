import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import {
  clampTableColWidth,
  TABLE_COL_BY_ID,
  TABLE_COLS,
  TableCol,
  TableSort,
} from '../boards.util';
import { TaskSortKey } from '../../tasks/task-criteria/task-criteria';
import { TableColId } from '../../tasks/task-table.token';

/**
 * The header row of one section of a view's table: column names (a click
 * sorts the section by that column), a divider to drag per column (its
 * width), drag a name to reorder, and a picker for which columns show.
 * Plain HTML, no Material. Live widths go out as `draft`; one `changed` per
 * gesture (drag end, reorder, toggle) is the stored change.
 */
@Component({
  selector: 'board-table-header',
  standalone: true,
  imports: [CdkDropList, CdkDrag, NgTemplateOutlet, TranslatePipe],
  templateUrl: './board-table-header.component.html',
  styleUrl: './board-table-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  /* eslint-disable @typescript-eslint/naming-convention */
  host: {
    role: 'row',
    '(contextmenu)': 'openPicker($event)',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(keydown.escape)': 'isPickerOpen.set(false)',
  },
  /* eslint-enable @typescript-eslint/naming-convention */
})
export class BoardTableHeaderComponent {
  private _el = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The shown columns, title first (`getTableCols`). */
  cols = input.required<readonly TableCol[]>();
  /** The section's sort; null = manual order. */
  sort = input<TableSort | null>(null);
  draft = output<TableCol[] | null>();
  changed = output<TableCol[]>();
  /** A sortable column's name clicked (`getTableSortClickChanges`). */
  sortBy = output<TableColId>();
  // A name dragged to reorder: its release isn't a sort click.
  isDragged = false;

  readonly isPickerOpen = signal(false);
  // Viewport px. Fixed in the top layer: the sticky headers' stacking would
  // otherwise paint the next sections over it.
  protected readonly pickerPos = signal<{ top: number; left?: number; right?: number }>({
    top: 0,
  });
  private readonly _picker = viewChild<ElementRef<HTMLElement>>('picker');
  private readonly _showPicker = effect(() =>
    this._picker()?.nativeElement.showPopover(),
  );
  protected readonly T = T;
  protected readonly ALL_COLS = TABLE_COLS.filter((col) => col.id !== 'title');
  protected labelOf(id: TableColId): string {
    return TABLE_COL_BY_ID.get(id)?.label ?? id;
  }

  protected sortKeyOf(id: TableColId): TaskSortKey | undefined {
    return TABLE_COL_BY_ID.get(id)?.sortKey;
  }

  protected ariaSortOf(id: TableColId): 'ascending' | 'descending' | null {
    const sort = this.sort();
    if (!sort || sort.key !== this.sortKeyOf(id)) return null;
    return sort.dir === 'desc' ? 'descending' : 'ascending';
  }

  onNameClick(id: TableColId): void {
    if (this.isDragged) {
      this.isDragged = false;
      return;
    }
    this.sortBy.emit(id);
  }

  protected isShown(id: TableColId): boolean {
    return this.cols().some((col) => col.id === id);
  }

  toggleCol(id: TableColId): void {
    const cols = this.cols();
    if (this.isShown(id)) {
      this.changed.emit(cols.filter((col) => col.id !== id));
      return;
    }
    this.changed.emit([...cols, { id, width: TABLE_COL_BY_ID.get(id)?.width ?? 100 }]);
  }

  drop(ev: CdkDragDrop<unknown>): void {
    if (ev.previousIndex === ev.currentIndex) return;
    // The drop list holds the columns after the title.
    const [title, ...rest] = this.cols();
    const moved = [...rest];
    moved.splice(ev.currentIndex, 0, ...moved.splice(ev.previousIndex, 1));
    this.changed.emit([title, ...moved]);
  }

  /**
   * Drags a column's start edge: the columns are anchored at the row's end,
   * so moving the edge left widens it. Live widths go out as `draft`; the
   * release stores them once.
   */
  startResize(ev: PointerEvent, id: TableColId): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const handle = ev.currentTarget as HTMLElement;
    handle.setPointerCapture(ev.pointerId);
    const startX = ev.clientX;
    const widen = this._widenDir();
    const start = this.cols();
    const startWidth = start.find((col) => col.id === id)?.width ?? 0;
    let latest: TableCol[] | null = null;

    const onMove = (move: PointerEvent): void => {
      const delta = (startX - move.clientX) * widen;
      const width = clampTableColWidth(startWidth + delta);
      latest = start.map((col) => (col.id === id ? { ...col, width } : col));
      this.draft.emit(latest);
    };
    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (latest && latest.some((col, i) => col.width !== start[i].width)) {
        this.changed.emit(latest);
      }
      this.draft.emit(null);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  /** Arrow keys on a divider: 8px per press, stored at once. */
  resizeByKey(ev: KeyboardEvent, id: TableColId): void {
    const step = ev.key === 'ArrowLeft' ? 8 : ev.key === 'ArrowRight' ? -8 : 0;
    if (!step) return;
    ev.preventDefault();
    const delta = step * this._widenDir();
    this.changed.emit(
      this.cols().map((col) =>
        col.id === id ? { ...col, width: clampTableColWidth(col.width + delta) } : col,
      ),
    );
  }

  /**
   * Which way a pointer move widens a column, as a sign on its leftward
   * distance: the columns sit at the row's end, so moving their start edge
   * toward the start widens them (left, or right in RTL).
   */
  private _widenDir(): 1 | -1 {
    return getComputedStyle(this._el.nativeElement).direction === 'rtl' ? -1 : 1;
  }

  /** Right-click: opens at the pointer, toward the side with room. */
  openPicker(ev: MouseEvent): void {
    ev.preventDefault();
    const w = window.innerWidth;
    this.pickerPos.set(
      ev.clientX > w / 2
        ? { top: ev.clientY, right: w - ev.clientX }
        : { top: ev.clientY, left: ev.clientX },
    );
    this.isPickerOpen.set(true);
  }

  /** The picker button: opens under it, its end edge on the button's. */
  togglePicker(btn: HTMLElement): void {
    const rect = btn.getBoundingClientRect();
    this.pickerPos.set({ top: rect.bottom, right: window.innerWidth - rect.right });
    this.isPickerOpen.set(!this.isPickerOpen());
  }

  onDocumentPointerDown(ev: PointerEvent): void {
    if (
      this.isPickerOpen() &&
      !(ev.target instanceof Node && this._el.nativeElement.contains(ev.target))
    ) {
      this.isPickerOpen.set(false);
    }
  }
}
