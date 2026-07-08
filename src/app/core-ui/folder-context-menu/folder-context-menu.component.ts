import { ChangeDetectionStrategy, Component, inject, Input } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { take } from 'rxjs/operators';

import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { MatMenuItem } from '@angular/material/menu';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { DialogPromptComponent } from '../../ui/dialog-prompt/dialog-prompt.component';
import {
  DialogCreateTagComponent,
  CreateTagData,
} from '../../ui/dialog-create-tag/dialog-create-tag.component';
import { MenuTreeService } from '../../features/menu-tree/menu-tree.service';
import {
  MenuTreeFolderNode,
  MenuTreeKind,
} from '../../features/menu-tree/store/menu-tree.model';
import { TagService } from '../../features/tag/tag.service';
import { Router } from '@angular/router';

@Component({
  selector: 'folder-context-menu',
  templateUrl: './folder-context-menu.component.html',
  styleUrls: ['./folder-context-menu.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatMenuItem, MatIcon, TranslateModule],
  standalone: true,
})
export class FolderContextMenuComponent {
  private readonly _matDialog = inject(MatDialog);
  private readonly _translateService = inject(TranslateService);
  private readonly _menuTreeService = inject(MenuTreeService);
  private readonly _tagService = inject(TagService);
  private readonly _router = inject(Router);

  @Input() folderId!: string;
  @Input() treeKind: MenuTreeKind = MenuTreeKind.PROJECT;

  readonly T = T;
  readonly MenuTreeKind = MenuTreeKind;

  editFolder(): void {
    const folder = this._loadFolder(this.folderId);
    if (!folder) return;

    const folderNs =
      this.treeKind === MenuTreeKind.PROJECT ? T.F.PROJECT_FOLDER : T.F.TAG_FOLDER;

    const dialogRef = this._matDialog.open(DialogPromptComponent, {
      restoreFocus: true,
      data: {
        txtLabel: this._translateService.instant(folderNs.DIALOG.NAME_LABEL),
        txtValue: folder.name,
        placeholder: this._translateService.instant(folderNs.DIALOG.NAME_PLACEHOLDER),
      },
    });

    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe((result: string | null) => {
        const trimmed = result?.trim();
        if (!trimmed || trimmed === folder.name) {
          return;
        }
        const cleanId = this._cleanFolderId(this.folderId);

        if (this.treeKind === MenuTreeKind.PROJECT) {
          this._menuTreeService.updateFolderInProject(cleanId, trimmed);
        } else {
          this._menuTreeService.updateFolderInTag(cleanId, trimmed);
        }
      });
  }

  deleteFolder(): void {
    const folder = this._loadFolder(this.folderId);
    if (!folder) return;

    const confirmKey =
      this.treeKind === MenuTreeKind.PROJECT
        ? T.F.PROJECT_FOLDER.CONFIRM_DELETE
        : T.F.TAG_FOLDER.CONFIRM_DELETE;

    const message = this._translateService.instant(confirmKey, {
      title: folder.name,
    });

    const dialogRef = this._matDialog.open(DialogConfirmComponent, {
      restoreFocus: true,
      data: { message },
    });

    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe((result: boolean) => {
        if (result) {
          const cleanId = this._cleanFolderId(this.folderId);

          if (this.treeKind === MenuTreeKind.PROJECT) {
            this._menuTreeService.deleteFolderFromProject(cleanId);
          } else {
            this._menuTreeService.deleteFolderFromTag(cleanId);
          }
        }
      });
  }

  addSubfolder(): void {
    const dialogRef = this._matDialog.open(DialogPromptComponent, {
      restoreFocus: true,
      data: {
        placeholder: this._translateService.instant(
          this.treeKind === MenuTreeKind.PROJECT
            ? T.F.PROJECT_FOLDER.DIALOG.NAME_PLACEHOLDER
            : T.F.TAG_FOLDER.DIALOG.NAME_PLACEHOLDER,
        ),
      },
    });

    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe((title) => {
        if (!title) return;
        const trimmed = title.trim();
        if (!trimmed) return;

        const cleanParentId = this._cleanFolderId(this.folderId);

        if (this.treeKind === MenuTreeKind.PROJECT) {
          this._menuTreeService.createProjectFolder(trimmed, cleanParentId);
        } else {
          this._menuTreeService.createTagFolder(trimmed, cleanParentId);
        }
      });
  }

  async addProject(): Promise<void> {
    const { DialogCreateProjectComponent } =
      await import('../../features/project/dialogs/create-project/dialog-create-project.component');
    this._matDialog
      .open(DialogCreateProjectComponent, {
        restoreFocus: true,
      })
      .afterClosed()
      .pipe(take(1))
      .subscribe((newProjectId: string | undefined) => {
        if (newProjectId) {
          const cleanParentId = this._cleanFolderId(this.folderId);

          this._menuTreeService.addProjectToFolder(newProjectId, cleanParentId);

          this._router.navigate([`project/${newProjectId}/tasks`]);
        }
      });
  }

  addTag(): void {
    const dialogRef = this._matDialog.open(DialogCreateTagComponent, {
      restoreFocus: true,
    });

    dialogRef
      .afterClosed()
      .pipe(take(1))
      .subscribe((result: CreateTagData) => {
        if (result && result.title) {
          const newTagId = this._tagService.addTag({
            title: result.title,
            icon: result.icon,
            color: result.color,
          });

          const cleanParentId = this._cleanFolderId(this.folderId);

          this._menuTreeService.addTagToFolder(newTagId, cleanParentId);
        }
      });
  }

  // Tree node ids are prefixed with 'folder-'; store/service APIs expect the raw id.
  private _cleanFolderId(id: string): string {
    return id.startsWith('folder-') ? id.substring(7) : id;
  }

  private _loadFolder(folderId: string): MenuTreeFolderNode | null {
    const cleanId = this._cleanFolderId(folderId);

    const projectTree = this._menuTreeService.projectTree();
    const tagTree = this._menuTreeService.tagTree();

    const primaryTree = this.treeKind === MenuTreeKind.PROJECT ? projectTree : tagTree;
    const secondaryTree = this.treeKind === MenuTreeKind.PROJECT ? tagTree : projectTree;

    return (
      this._menuTreeService.findFolderInTree(cleanId, primaryTree) ||
      this._menuTreeService.findFolderInTree(cleanId, secondaryTree)
    );
  }
}
