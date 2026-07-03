import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuTrigger } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Joined "split button": a primary default action plus an adjacent, compact
 * trigger that opens a menu of related/overflow options. The two halves render
 * as a single control (shared border, no gap). Pass the menu to open via
 * [menu]; project the default-action content as children.
 */
@Component({
  selector: 'split-button',
  standalone: true,
  imports: [MatButton, MatIcon, MatMenuTrigger, MatTooltip, TranslatePipe],
  templateUrl: './split-button.component.html',
  styleUrl: './split-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplitButtonComponent {
  readonly menu = input.required<MatMenu>();
  readonly disabled = input<boolean>(false);
  // Translation key used for the trigger's tooltip and aria-label.
  readonly triggerLabel = input<string>('');
  // Resolved (already translated) label for the main button's tooltip and
  // aria-label. Use when the projected content is abbreviated (e.g. just a
  // time) so the full action stays discoverable to screen readers and on hover.
  readonly mainLabel = input<string>('');

  readonly mainClick = output<MouseEvent>();
}
