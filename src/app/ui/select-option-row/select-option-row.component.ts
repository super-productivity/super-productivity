import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { Project } from '../../features/project/project.model';
import { Tag } from '../../features/tag/tag.model';
import { MenuTreeService } from '../../features/menu-tree/menu-tree.service';
import { isSingleEmoji } from '../../util/extract-first-emoji';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

export interface SelectOptionRowItem {
  id?: string;
  title: string;
  icon?: string;
  color?: string;
  theme?: { primary: string };
}

@Component({
  selector: 'select-option-row',
  standalone: true,
  imports: [CommonModule, MatIcon],
  templateUrl: './select-option-row.component.html',
  styleUrl: './select-option-row.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectOptionRowComponent {
  private readonly _menuTreeService = inject(MenuTreeService);

  item = input.required<Project | Tag | SelectOptionRowItem>();
  allOptions = input<(Project | Tag | SelectOptionRowItem)[]>();
  isSelected = input<boolean>(false);
  showCheckbox = input<boolean>(false);

  title = computed(() => this.item().title);
  icon = computed(() => this.item().icon);

  color = computed(() => {
    const item = this.item();
    return 'color' in item ? item.color || item.theme?.primary : item.theme?.primary;
  });

  isEmoji = computed(() => {
    const icon = this.icon();
    return !!icon && isSingleEmoji(icon);
  });

  defaultIcon = computed(() => {
    return 'backlogTaskIds' in this.item() ? 'list' : 'label';
  });

  folder = computed(() => {
    const item = this.item();
    const id = item.id;
    if (!id) {
      return null;
    }

    const all = this.allOptions();
    if (all) {
      const title = item.title.trim().toLowerCase();
      const hasCollision = all.some(
        (other) => other.id !== id && other.title.trim().toLowerCase() === title,
      );
      if (!hasCollision) {
        return null;
      }
    }

    return (
      this._menuTreeService.projectFolderMap().get(id) ||
      this._menuTreeService.tagFolderMap().get(id) ||
      null
    );
  });
}
