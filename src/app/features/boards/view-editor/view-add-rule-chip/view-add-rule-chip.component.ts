import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { getAddRuleMenu, VIEW_RULE_LABELS, ViewRuleId } from '../view-editor.util';

/**
 * "Add rule" as a dashed chip (a full-width row on a phone): its menu lists
 * every rule by group; rules the section shows are checked, rules that
 * contradict one it shows say which.
 */
@Component({
  selector: 'view-add-rule-chip',
  standalone: true,
  imports: [MatIcon, MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger, TranslatePipe],
  templateUrl: './view-add-rule-chip.component.html',
  styleUrl: '../view-editor-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  host: { '[class.is-row]': "variant() === 'row'" },
})
export class ViewAddRuleChipComponent {
  /** The rules the section shows. */
  readonly shownRules = input.required<readonly ViewRuleId[]>();
  readonly variant = input<'chip' | 'row'>('chip');
  readonly addRule = output<ViewRuleId>();

  protected readonly T = T;
  protected readonly RULE_LABELS = VIEW_RULE_LABELS;

  readonly groups = computed(() => getAddRuleMenu(this.shownRules()));
}
