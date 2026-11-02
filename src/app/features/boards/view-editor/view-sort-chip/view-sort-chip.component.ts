import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { BoardPanelCfg } from '../../boards.model';
import { T } from '../../../../t.const';
import {
  getSortValue,
  OTHER_VALUE,
  SORT_MANUAL,
  SORT_OPTIONS,
  withSortValue,
} from '../view-editor.util';

type SortDir = 'asc' | 'desc';

const SORT_DIRS: readonly { value: SortDir; label: string; arrow: string }[] = [
  { value: 'asc', label: T.F.BOARDS.FORM.SORT_DIR_ASC, arrow: '↑' },
  { value: 'desc', label: T.F.BOARDS.FORM.SORT_DIR_DESC, arrow: '↓' },
];

/**
 * A section's sort as a chip ("Deadline ↑"): its menu picks the key and,
 * unless the order is manual, the direction.
 */
@Component({
  selector: 'view-sort-chip',
  standalone: true,
  imports: [
    MatIcon,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatMenuTrigger,
    MatDivider,
    TranslatePipe,
  ],
  templateUrl: './view-sort-chip.component.html',
  styleUrl: '../view-editor-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewSortChipComponent {
  readonly panel = input.required<BoardPanelCfg>();
  readonly panelChange = output<BoardPanelCfg>();

  protected readonly T = T;
  protected readonly OTHER_VALUE = OTHER_VALUE;
  protected readonly SORT_OPTIONS = SORT_OPTIONS;
  protected readonly SORT_DIRS = SORT_DIRS;

  readonly value = computed(() => getSortValue(this.panel()));
  readonly label = computed(() => {
    const value = this.value();
    return (
      SORT_OPTIONS.find((option) => option.value === value)?.label ??
      T.F.BOARDS.EDITOR.OTHER_KEPT
    );
  });
  /** Manual order (or a key this client doesn't know) has no direction. */
  readonly isSorted = computed(
    () => this.value() !== SORT_MANUAL && this.value() !== OTHER_VALUE,
  );
  readonly dir = computed<SortDir>(() =>
    this.panel().sortDir === 'desc' ? 'desc' : 'asc',
  );

  readonly dirLabel = computed(
    () => SORT_DIRS.find((sortDir) => sortDir.value === this.dir())?.label ?? '',
  );

  setSort(value: string): void {
    this.panelChange.emit(withSortValue(this.panel(), value));
  }

  setDir(dir: SortDir): void {
    this.panelChange.emit({ ...this.panel(), sortDir: dir });
  }
}
