import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { MatRipple } from '@angular/material/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuContent, MatMenuTrigger } from '@angular/material/menu';
import { WorkContextMenuComponent } from '../../work-context-menu/work-context-menu.component';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { TaskViewCustomizerService } from '../../../features/task-view-customizer/task-view-customizer.service';
import { TaskViewCustomizerPanelComponent } from '../../../features/task-view-customizer/task-view-customizer-panel/task-view-customizer-panel.component';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { KeyboardConfig } from '../../../features/config/keyboard-config.model';

@Component({
  selector: 'page-title',
  standalone: true,
  imports: [
    RouterLink,
    MatRipple,
    MatTooltip,
    MatIconButton,
    MatIcon,
    MatMenu,
    MatMenuContent,
    MatMenuTrigger,
    WorkContextMenuComponent,
    TaskViewCustomizerPanelComponent,
    TranslatePipe,
  ],
  template: `
    @if (activeWorkContextTypeAndId()) {
      <div
        [matTooltip]="T.MH.GO_TO_TASK_LIST | translate"
        class="page-title"
        mat-ripple
        routerLink="/active/tasks"
      >
        {{ displayTitle() }}
      </div>
      @if (!isXxxs()) {
        <div class="page-title-actions">
          <button
            [mat-menu-trigger-for]="activeWorkContextMenu"
            [matTooltip]="T.MH.PROJECT_MENU | translate"
            class="project-settings-btn"
            mat-icon-button
          >
            <mat-icon>more_vert</mat-icon>
          </button>
          @if (isWorkViewPage()) {
            <button
              class="task-filter-btn"
              [class.isCustomized]="taskViewCustomizerService.isCustomized()"
              [matMenuTriggerFor]="customizerPanel.menu"
              mat-icon-button
              matTooltip="{{
                T.GCF.KEYBOARD.TOGGLE_TASK_VIEW_CUSTOMIZER_PANEL | translate
              }} {{
                kb.toggleTaskViewCustomizerPanel
                  ? '[' + kb.toggleTaskViewCustomizerPanel + ']'
                  : ''
              }}"
            >
              <mat-icon>filter_list</mat-icon>
            </button>

            <task-view-customizer-panel #customizerPanel></task-view-customizer-panel>
          }
        </div>
      }
      <mat-menu #activeWorkContextMenu="matMenu">
        <ng-template matMenuContent>
          <work-context-menu
            [contextId]="activeWorkContextTypeAndId()!.activeId"
            [contextType]="activeWorkContextTypeAndId()!.activeType"
          ></work-context-menu>
        </ng-template>
      </mat-menu>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .page-title {
        font-size: 18px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
        cursor: pointer;
        border-radius: var(--card-border-radius);
        padding: var(--s) var(--s2) var(--s) var(--s);

        @media (min-width: 600px) {
          padding-left: 0;
          padding-right: var(--s);
        }

        &:focus {
          outline: none;
        }
      }

      .page-title-actions {
        display: flex;
        align-items: center;
        gap: var(--s-quarter);
        margin-left: calc(-1 * var(--s));
        margin-right: var(--s2);
      }

      .project-settings-btn {
        opacity: 1;

        /*display: none;*/
        /*@media (min-width: 600px) {*/
        /*  display: block;*/
        /*  transition: var(--transition-standard);*/
        /*  opacity: 0;*/
        /*  position: relative;*/
        /*  z-index: 1;*/
        /*}*/

        /*&:hover,*/
        /*.page-title:hover + .page-title-actions &,*/
        /*.page-title-actions:hover & {*/
        /*  opacity: 1;*/
        /*}*/
      }

      .task-filter-btn {
        position: relative;
        transition: all 0.2s ease;
        overflow: visible !important;

        .mat-icon {
          transition: transform 0.2s ease;
          display: block;
        }

        &.isCustomized {
          color: var(--c-accent);
          box-shadow: none;
        }

        &:hover:not(.isCustomized):not(:disabled) {
          background-color: var(--hover-color, rgba(0, 0, 0, 0.04));
        }

        &:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: transparent !important;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PageTitleComponent {
  private _breakpointObserver = inject(BreakpointObserver);
  private _router = inject(Router);
  private _workContextService = inject(WorkContextService);
  readonly taskViewCustomizerService = inject(TaskViewCustomizerService);
  private readonly _configService = inject(GlobalConfigService);
  private _translateService = inject(TranslateService);

  readonly T = T;

  // Get data directly from services instead of inputs
  activeWorkContextTitle = toSignal(this._workContextService.activeWorkContextTitle$);
  activeWorkContextTypeAndId = toSignal(
    this._workContextService.activeWorkContextTypeAndId$,
  );

  // Route detection observables
  private _isScheduleSection$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => !!event.urlAfterRedirects.match(/(schedule)$/)),
    startWith(!!this._router.url.match(/(schedule)$/)),
  );
  isScheduleSection = toSignal(this._isScheduleSection$, { initialValue: false });

  private _isPlannerSection$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => !!event.urlAfterRedirects.match(/(planner)$/)),
    startWith(!!this._router.url.match(/(planner)$/)),
  );
  isPlannerSection = toSignal(this._isPlannerSection$, { initialValue: false });

  private _isBoardsSection$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => !!event.urlAfterRedirects.match(/(boards)$/)),
    startWith(!!this._router.url.match(/(boards)$/)),
  );
  isBoardsSection = toSignal(this._isBoardsSection$, { initialValue: false });

  private _isWorkViewPage$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => !!event.urlAfterRedirects.match(/tasks$/)),
    startWith(!!this._router.url.match(/tasks$/)),
  );
  isWorkViewPage = toSignal(this._isWorkViewPage$, { initialValue: false });

  private _isHabitsSection$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => !!event.urlAfterRedirects.match(/(habits)$/)),
    startWith(!!this._router.url.match(/(habits)$/)),
  );
  isHabitsSection = toSignal(this._isHabitsSection$, { initialValue: false });

  // Override title for special routes
  displayTitle = computed(() => {
    if (this.isScheduleSection()) {
      return this._translateService.instant(T.MH.SCHEDULE);
    }
    if (this.isPlannerSection()) {
      return this._translateService.instant(T.MH.PLANNER);
    }
    if (this.isBoardsSection()) {
      return this._translateService.instant(T.MH.BOARDS);
    }
    if (this.isHabitsSection()) {
      return this._translateService.instant(T.MH.HABITS);
    }
    return this.activeWorkContextTitle();
  });

  private _isXxxs$ = this._breakpointObserver.observe('(max-width: 350px)');
  isXxxs = toSignal(this._isXxxs$.pipe(map((result) => result.matches)), {
    initialValue: false,
  });

  get kb(): KeyboardConfig {
    return (this._configService.cfg()?.keyboard as KeyboardConfig) || {};
  }
}
