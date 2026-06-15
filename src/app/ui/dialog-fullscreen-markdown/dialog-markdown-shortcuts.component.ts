import { Component } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { T } from '../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { MARKDOWN_SHORTCUTS, shortcutLabels } from './markdown-shortcuts.const';

@Component({
  selector: 'dialog-markdown-shortcuts',
  templateUrl: './dialog-markdown-shortcuts.component.html',
  styleUrls: ['./dialog-markdown-shortcuts.component.scss'],
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, TranslatePipe],
})
export class DialogMarkdownShortcutsComponent {
  readonly T = T;
  readonly MARKDOWN_SHORTCUTS = MARKDOWN_SHORTCUTS;
  readonly shortcutLabels = shortcutLabels;
}
