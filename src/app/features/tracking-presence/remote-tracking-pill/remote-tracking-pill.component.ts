import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { TrackingPresenceService } from '../tracking-presence.service';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { ShortTimePipe } from '../../../ui/pipes/short-time.pipe';

/**
 * Ambient chip naming what ANOTHER device is tracking, shown in the header's
 * pill slot when this device is not tracking itself. Deliberately quiet: no
 * ticking counter (a live-looking timer on relayed state would overstate what
 * the producer will credit — idle handling even removes time retroactively),
 * just the task, the device and a static "since". Stale state flips to past
 * tense and loses the Stop action; after 30 min it disappears entirely.
 */
@Component({
  selector: 'remote-tracking-pill',
  standalone: true,
  imports: [MatIcon, MatTooltip, TranslatePipe, ShortTimePipe],
  animations: [fadeAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <div
        @fade
        class="remote-pill"
        [class.isStale]="v.isStale"
      >
        <mat-icon class="device-icon">devices</mat-icon>
        <div class="text">
          <div class="task-title">{{ taskTitle() }}</div>
          <div class="sub">
            {{ v.stateKey | translate: { device: v.session.payload.deviceLabel } }}
            ·
            {{ v.timeKey | translate: { time: (v.timeTs | shortTime) || '' } }}
            @if (v.session.payload.focusCycle; as cycle) {
              · {{ T.F.TRACKING_PRESENCE.CHIP.FOCUS | translate: { cycle: cycle } }}
            }
          </div>
        </div>
        @if (v.showStop) {
          <button
            type="button"
            class="stop-btn"
            (click)="stopRemote()"
            [attr.aria-label]="
              T.F.TRACKING_PRESENCE.CHIP.STOP
                | translate: { device: v.session.payload.deviceLabel }
            "
            matTooltip="{{
              T.F.TRACKING_PRESENCE.CHIP.STOP
                | translate: { device: v.session.payload.deviceLabel }
            }}"
            matTooltipPosition="below"
          >
            <mat-icon>stop</mat-icon>
          </button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .remote-pill {
        /* Out of flow inside .pill-slot, same as tracked-task-pill: it can
           never move a header button, whatever its width. */
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        inset-inline-end: 0;
        max-width: min(100%, 520px);

        display: flex;
        align-items: center;
        gap: var(--s-half);
        white-space: nowrap;
        border: 1px dashed var(--c-accent);
        border-radius: 10px;
        padding: calc(var(--s-half) * 0.75) var(--s);
        background: var(--bg-lighter);
        font-size: 12px;

        &.isStale {
          opacity: 0.6;
          border-color: var(--extra-border-color, currentColor);
        }

        @container header-pill-slot (max-width: 220px) {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        @media (max-width: 599px) {
          display: none;
        }
      }

      .device-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }

      .text {
        min-width: 0;
      }

      .task-title {
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: 13px;
      }

      .sub {
        opacity: 0.7;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .stop-btn {
        appearance: none;
        border: none;
        background: none;
        color: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        padding: 0;
        flex-shrink: 0;

        &:hover {
          color: var(--c-accent);
        }
      }
    `,
  ],
})
export class RemoteTrackingPillComponent {
  readonly T = T;

  private _presenceService = inject(TrackingPresenceService);
  private _store = inject(Store);
  private _translateService = inject(TranslateService);

  private _taskEntities = this._store.selectSignal(selectTaskEntities);

  /** Shared view-model — staleness/label/Stop rules live in the service. */
  readonly view = this._presenceService.remoteSessionView;

  readonly taskTitle = computed(() => {
    const taskId = this.view()?.session.payload.taskId;
    if (!taskId) {
      return this._translateService.instant(T.F.TRACKING_PRESENCE.CHIP.FALLBACK_TASK);
    }
    // Ids-only payload: a task created remotely resolves only after the next
    // op sync (≤ ~5 min), so a truthful placeholder covers the gap.
    return (
      this._taskEntities()?.[taskId]?.title ??
      this._translateService.instant(T.F.TRACKING_PRESENCE.CHIP.FALLBACK_TASK)
    );
  });

  stopRemote(): void {
    this._presenceService.requestRemoteStop();
  }
}
