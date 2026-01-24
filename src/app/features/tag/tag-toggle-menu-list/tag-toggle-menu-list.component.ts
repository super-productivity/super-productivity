import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { TaskCopy } from '../../tasks/task.model';
import { toSignal } from '@angular/core/rxjs-interop';
import { TagService } from '../tag.service';
import { MatDialog } from '@angular/material/dialog';
import { DialogPromptComponent } from '../../../ui/dialog-prompt/dialog-prompt.component';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskService } from '../../tasks/task.service';
import { isSingleEmoji } from '../../../util/extract-first-emoji';
import { MenuTreeService } from '../../menu-tree/menu-tree.service';
import { MenuTreeKind, MenuTreeViewNode } from '../../menu-tree/store/menu-tree.model';
import { Tag } from '../tag.model';

@Component({
  selector: 'tag-toggle-menu-list',
  standalone: true,
  imports: [MatIcon, MatMenu, MatMenuContent, MatMenuItem, MatMenuTrigger, TranslatePipe],
  templateUrl: './tag-toggle-menu-list.component.html',
  styleUrl: './tag-toggle-menu-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagToggleMenuListComponent {
  private _tagService = inject(TagService);
  private _taskService = inject(TaskService);
  private _matDialog = inject(MatDialog);
  private _menuTreeService = inject(MenuTreeService);

  task = input.required<TaskCopy>();

  toggleTag = output<string>();
  afterClose = output<void>();
  addNewTag = output<string>();

  private _tagList = toSignal(this._tagService.tagsNoMyDayAndNoList$, {
    initialValue: [],
  });

  // Build tree from tags to maintain menu tree ordering
  private _tagTree = computed(() => {
    const tags = this._tagList();
    return this._menuTreeService.buildTagViewTree(tags);
  });

  // Extract tags in tree order (flattened)
  toggleTagList = computed(() => {
    const tree = this._tagTree();
    const tags: Tag[] = [];

    // Recursive function to extract tags maintaining order
    const extractTags = (nodes: MenuTreeViewNode[]): void => {
      for (const node of nodes) {
        if (node.k === MenuTreeKind.TAG) {
          tags.push(node.tag);
        } else if (node.k === MenuTreeKind.FOLDER) {
          extractTags(node.children);
        }
      }
    };

    extractTags(tree);

    // Map to include isEmojiIcon
    return tags.map((tag) => ({
      ...tag,
      isEmojiIcon: tag.icon ? isSingleEmoji(tag.icon) : false,
    }));
  });
  menuEl = viewChild('menuEl', {
    // read: MatMenu,
  });
  tagMenuTriggerEl = viewChild('tagMenuTriggerEl', {
    read: MatMenuTrigger,
  });

  onTagMenuKeydown(ev: KeyboardEvent, tagId: string): void {
    if (ev.code === 'Space') {
      ev.preventDefault();
      ev.stopPropagation();
      this.toggleTag.emit(tagId);
    }
  }

  onMenuClosed(): void {
    this.afterClose.emit();
  }

  openMenu(ev?: MouseEvent | KeyboardEvent | TouchEvent): void {
    this.tagMenuTriggerEl()?.openMenu();
  }

  openAddNewTag(): void {
    this._matDialog
      .open(DialogPromptComponent, {
        data: {
          placeholder: T.F.TAG.TTL.ADD_NEW_TAG,
        },
      })
      .afterClosed()
      .subscribe((val) => {
        if (val) {
          const t = this.task();
          const newTagId = this._tagService.addTag({
            title: val,
          });
          this._taskService.updateTags(t, [...t.tagIds, newTagId]);
        }
      });
  }

  protected readonly T = T;
}
