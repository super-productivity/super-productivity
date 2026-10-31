import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { IssueProviderPlainspace } from '../../issue/issue.model';
import { PlainspaceConnectionStateService } from '../../issue/providers/plainspace/plainspace-connection-state.service';
import {
  PlainspaceConnectDialogComponent,
  PlainspaceConnectDialogData,
} from '../connect-dialog/plainspace-connect-dialog.component';

/**
 * Shown in a Plainspace provider's issue panel tab while Plainspace rejects its
 * token (401). Reconnecting hands the new token to every provider that held
 * the rejected one. Offline and server errors never show it. Also says once
 * when the provider's server is too old to take titles.
 */
@Component({
  selector: 'plainspace-reconnect-notice',
  templateUrl: './plainspace-reconnect-notice.component.html',
  styleUrls: ['./plainspace-reconnect-notice.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatIcon, TranslatePipe],
})
export class PlainspaceReconnectNoticeComponent {
  private readonly _connectionState = inject(PlainspaceConnectionStateService);
  private readonly _matDialog = inject(MatDialog);

  readonly T = T;
  readonly issueProvider = input.required<IssueProviderPlainspace>();
  readonly isRejected = computed(() =>
    this._connectionState.rejectedProviderIds().has(this.issueProvider().id),
  );
  readonly isServerTooOld = computed(() =>
    this._connectionState.serverTooOldProviderIds().has(this.issueProvider().id),
  );

  reconnect(): void {
    const ip = this.issueProvider();
    const data: PlainspaceConnectDialogData = { host: ip.host, replacedToken: ip.token };
    this._matDialog.open(PlainspaceConnectDialogComponent, { data });
  }
}
