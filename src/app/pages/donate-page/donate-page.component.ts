import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { T } from '../../t.const';
import { TranslatePipe } from '@ngx-translate/core';
import { IS_APPLE_APP_STORE } from '../../app.constants';

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
  // Hides the whole page body on Apple App Store builds — the route stays
  // reachable by direct URL even though the nav entry is gone. See IS_APPLE_APP_STORE.
  readonly IS_APPLE_APP_STORE = IS_APPLE_APP_STORE;
}
