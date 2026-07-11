import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { IS_DONATION_UI_RESTRICTED } from '../../app.constants';

@Component({
  selector: 'donate-page',
  templateUrl: './donate-page.component.html',
  styleUrls: ['./donate-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIcon, TranslatePipe],
  standalone: true,
})
export class DonatePageComponent {
  readonly T = T;
  // Defense in depth: DonatePageGuard redirects restricted platforms before
  // this component renders, and this gate prevents accidental direct rendering.
  readonly IS_DONATION_UI_RESTRICTED = IS_DONATION_UI_RESTRICTED;
}
