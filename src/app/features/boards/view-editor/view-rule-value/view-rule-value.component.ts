import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { TagComponent, TagComponentTag } from '../../../tag/tag/tag.component';
import { RulePart } from '../view-editor.util';

/**
 * A rule as `Label: value`, inline: the option, the tags or projects with
 * their icon and color, and what can't be shown (missing tags, deleted or
 * archived projects, a value this client doesn't know).
 */
@Component({
  selector: 'view-rule-value',
  standalone: true,
  imports: [MatIcon, TranslatePipe, TagComponent],
  templateUrl: './view-rule-value.component.html',
  styleUrl: './view-rule-value.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // eslint-disable-next-line @typescript-eslint/naming-convention
  host: { '[class.no-label]': '!isLabelShown()' },
})
export class ViewRuleValueComponent {
  readonly part = input.required<RulePart>();
  /** The tags (or, for the project rule, projects) by id. */
  readonly items = input<ReadonlyMap<string, TagComponentTag>>(new Map());
  /** Without: the value alone, below a label shown elsewhere (a phone's row). */
  readonly isLabelShown = input<boolean>(true);

  protected readonly T = T;

  readonly shownItems = computed(() => {
    const items = this.items();
    return (this.part().ids ?? []).flatMap((id) => {
      const item = items.get(id);
      return item ? [{ id, item }] : [];
    });
  });
  readonly hasValue = computed(() => {
    const part = this.part();
    return !!part.value || !!part.isOther || !!part.ids?.length || !!part.missingCount;
  });
}
