import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { expandFadeAnimation } from '../animations/expand.ani';
import { T } from '../../t.const';

/**
 * Short help for a section, opened with a `help-toggle-btn` placed where it
 * fits the host (section header, dialog title). Depth lives in the public docs.
 */
@Component({
  selector: 'help-section',
  templateUrl: './help-section.component.html',
  styleUrls: ['./help-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation],
  imports: [MatIcon, TranslatePipe],
})
export class HelpSectionComponent {
  readonly isShowHelp = input(false);
  /** Page on super-productivity.com/docs that covers this section in depth. */
  readonly docsUrl = input<string>();
  readonly T = T;
}
