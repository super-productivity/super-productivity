import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { SearchResultItem } from '../../issue/issue.model';
import { isIssueDone } from '../../issue/mapping-helper/is-issue-done';
import { IssueService } from '../../issue/issue.service';
import { ICAL_TYPE } from '../../issue/issue.const';
import { IS_ELECTRON } from '../../../app.constants';
import { T } from '../../../t.const';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'issue-preview-item',
  imports: [MatIconButton, MatIcon, TranslatePipe],
  templateUrl: './issue-preview-item.component.html',
  styleUrl: './issue-preview-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  /* eslint-disable @typescript-eslint/naming-convention*/
  host: {
    '[class.isDone]': 'isIssueDone()',
  },
})
export class IssuePreviewItemComponent {
  readonly T: typeof T = T;
  public readonly ICAL_TYPE = ICAL_TYPE;
  private _issueService = inject(IssueService);

  issueProviderId = input.required<string>();
  itemData = input.required<SearchResultItem>();
  addIssue = output<SearchResultItem>();
  isIssueDone = computed(() => {
    return isIssueDone(this.itemData());
  });
  customTitleStr = input<string | undefined>();

  async openIssue(): Promise<void> {
    const url = await this._issueService.issueLink(
      this.itemData().issueType,
      this.itemData().issueData.id,
      this.issueProviderId(),
    );
    window.open(url, '_blank');
  }

  openCalendarEventUrl(): void {
    const url = (this.itemData().issueData as { url?: string })?.url;
    if (url) {
      if (IS_ELECTRON) {
        window.ea.openExternalUrl(url);
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  }
}
