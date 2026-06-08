import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { isSingleEmoji } from '../../util/extract-first-emoji';
import { MatIcon } from '@angular/material/icon';

@Component({
  selector: 'select-option-row',
  standalone: true,
  imports: [MatIcon],
  templateUrl: './select-option-row.component.html',
  styleUrl: './select-option-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectOptionRowComponent {
  title = input.required<string>();
  icon = input<string | undefined>();
  defaultIcon = input<string | undefined>();
  color = input<string | undefined>();
  folderPath = input<string | null | undefined>(null);
  isSelected = input<boolean>(false);
  showCheckbox = input<boolean>(false);

  effectiveIcon = computed(() => this.icon() || this.defaultIcon());

  isEmoji = computed(() => {
    const icon = this.effectiveIcon();
    return !!icon && isSingleEmoji(icon);
  });
}
