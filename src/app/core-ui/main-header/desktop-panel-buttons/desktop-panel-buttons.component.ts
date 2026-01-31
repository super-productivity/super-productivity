import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { LayoutService } from '../../layout/layout.service';
import { T } from '../../../t.const';
import { KeyboardConfig } from '../../../features/config/keyboard-config.model';
import { GlobalConfigService } from '../../../features/config/global-config.service';

@Component({
  selector: 'desktop-panel-buttons',
  standalone: true,
  imports: [MatIconButton, MatIcon, MatTooltip, TranslatePipe],
  template: `
    @if (isScheduleDayPanelEnabled()) {
      <button
        class="panel-btn e2e-toggle-schedule-day-panel"
        [disabled]="!isRouteWithSidePanel()"
        [class.isActive]="isShowScheduleDayPanel()"
        (click)="layoutService.toggleScheduleDayPanel()"
        mat-icon-button
        matTooltip="{{ T.MH.SCHEDULE | translate }}"
      >
        <mat-icon>schedule</mat-icon>
      </button>
    }

    @if (isIssuesPanelEnabled()) {
      <button
        class="panel-btn e2e-toggle-issue-provider-panel"
        [disabled]="!isRouteWithSidePanel()"
        [class.isActive]="isShowIssuePanel()"
        (click)="layoutService.toggleAddTaskPanel()"
        mat-icon-button
        matTooltip="{{ T.MH.TOGGLE_SHOW_ISSUE_PANEL | translate }} {{
          kb()?.toggleIssuePanel ? '[' + kb()?.toggleIssuePanel + ']' : ''
        }}"
      >
        <mat-icon>dashboard_customize</mat-icon>
      </button>
    }

    @if (isProjectNotesEnabled()) {
      <button
        class="panel-btn e2e-toggle-notes-btn"
        [disabled]="!isRouteWithSidePanel()"
        [class.isActive]="isShowNotes()"
        (click)="layoutService.toggleNotes()"
        mat-icon-button
        matTooltip="{{ T.MH.TOGGLE_SHOW_NOTES | translate }} {{
          kb()?.openProjectNotes ? '[' + kb()?.openProjectNotes + ']' : ''
        }}"
      >
        <mat-icon>comment</mat-icon>
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .panel-btn {
        position: relative;
        transition: all 0.2s ease;
        overflow: visible !important;

        .mat-icon {
          transition: transform 0.2s ease;
          display: block;
        }

        &.isActive {
          box-shadow: 0px -2px 3px 0px var(--separator-alpha);
          background-color: transparent;

          &::after {
            border-radius: 4px;
          }

          .mat-icon {
            transform: rotate(45deg);
          }
        }

        &:hover:not(.isActive):not(:disabled) {
          background-color: var(--hover-color, rgba(0, 0, 0, 0.04));
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: transparent !important;
        }

        &:disabled::after {
          background: transparent !important;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesktopPanelButtonsComponent {
  readonly T = T;
  readonly layoutService = inject(LayoutService);
  private readonly _configService = inject(GlobalConfigService);

  readonly kb = input<KeyboardConfig | null>();
  readonly isRouteWithSidePanel = input.required<boolean>();
  readonly isShowScheduleDayPanel = input.required<boolean>();
  readonly isShowIssuePanel = input.required<boolean>();
  readonly isShowNotes = input.required<boolean>();

  readonly isIssuesPanelEnabled = computed(
    () => this._configService.appFeatures().isIssuesPanelEnabled,
  );
  readonly isScheduleDayPanelEnabled = computed(
    () => this._configService.appFeatures().isScheduleDayPanelEnabled,
  );
  readonly isProjectNotesEnabled = computed(
    () => this._configService.appFeatures().isProjectNotesEnabled,
  );
}
