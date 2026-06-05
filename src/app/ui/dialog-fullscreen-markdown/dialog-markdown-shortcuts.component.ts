import { Component } from '@angular/core'; // Add ViewEncapsulation
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { T } from '../../t.const';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'dialog-markdown-shortcuts',
  templateUrl: './dialog-markdown-shortcuts.component.html',
  styleUrls: ['./dialog-markdown-shortcuts.component.scss'],
  standalone: true,
  imports: [MatButtonModule, MatDialogModule, TranslatePipe],
})
export class DialogMarkdownShortcutsComponent {
  readonly T = T;
}
