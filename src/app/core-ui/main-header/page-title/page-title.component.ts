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
import { of } from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { WorkContextService } from '../../../features/work-context/work-context.service';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { DEFAULT_PROJECT_ICON } from '../../../features/project/project.const';
import { isSingleEmoji } from '../../../util/extract-first-emoji';
import { selectIsProjectSharedOnPlainspace } from '../../../features/issue/store/issue-provider.selectors';
import { PlainspaceShareService } from '../../../features/issue/providers/plainspace/plainspace-share.service';
import { TaskViewCustomizerService } from '../../../features/task-view-customizer/task-view-customizer.service';
import { TaskViewCustomizerPanelComponent } from '../../../features/task-view-customizer/task-view-customizer-panel/task-view-customizer-panel.component';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { KeyboardConfig } from '@sp/keyboard-config';

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
        @if (!isSpecialSection() && activeWorkContext()) {
          <mat-icon
            class="page-title-icon"
            [class.page-title-icon--emoji]="isContextEmojiIcon()"
            [style.color]="contextIconColor()"
            >{{ contextIcon() }}</mat-icon
          >
        }
        <span class="page-title-text">{{ displayTitle() }}</span>
      </div>
      @if (!isXxxs() && !isSpecialSection()) {
        <div class="page-title-actions">
          @if (isSharedOnPlainspace()) {
            <button
              (click)="openInPlainspace()"
              [matTooltip]="T.PLAINSPACE.OPEN_IN_PLAINSPACE | translate"
              [attr.aria-label]="T.PLAINSPACE.OPEN_IN_PLAINSPACE | translate"
              mat-icon-button
            >
              <mat-icon svgIcon="plainspace"></mat-icon>
            </button>
          }
          <button
            [mat-menu-trigger-for]="activeWorkContextMenu"
            [matTooltip]="T.MH.PROJECT_MENU | translate"
            [attr.aria-label]="T.MH.PROJECT_MENU | translate"
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
              [attr.aria-label]="
                T.GCF.KEYBOARD.TOGGLE_TASK_VIEW_CUSTOMIZER_PANEL | translate
              "
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
        display: flex;
        align-items: center;
        gap: var(--s-half);
        font-size: 18px;
        overflow: hidden;
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

      .page-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }

      /* Mirrors the side-nav work-context icon so the same project/tag reads
         identically in the nav and the header (icon value, emoji handling and
         theme/tag color). See nav-item.component. */
      .page-title-icon {
        flex: 0 0 auto;
        font-size: 20px;
        width: 20px;
        height: 20px;
        line-height: 20px;
        overflow: visible;

        &.page-title-icon--emoji {
          font-family:
            'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
          font-size: 18px;
          font-feature-settings: normal;
          font-variation-settings: normal;
          text-transform: none;
          letter-spacing: normal;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
      }

      .page-title-actions {
        display: flex;
        align-items: center;
        /* Don't let the menu/filter buttons shrink; the title absorbs the
           squeeze instead (#7477). */
        flex: 0 0 auto;
        gap: var(--s-quarter);
        margin-left: calc(-1 * var(--s));
        margin-right: var(--s2);
      }

      .project-settings-btn {
        opacity: 1;
        color: var(--text-color-muted);

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
        color: var(--text-color-muted);
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

      :host-context(.wrapper:hover) .project-settings-btn,
      :host-context(.wrapper:hover) .task-filter-btn:not(.isCustomized),
      :host-context(.wrapper:focus-within) .project-settings-btn,
      :host-context(.wrapper:focus-within) .task-filter-btn:not(.isCustomized),
      .page-title-actions:is(:hover, :focus-within) .project-settings-btn,
      .page-title-actions:is(:hover, :focus-within) .task-filter-btn:not(.isCustomized) {
        color: var(--text-color);
      }

      .project-settings-btn[aria-expanded='true'] {
        color: var(--brand);
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
  private _store = inject(Store);
  private _plainspaceShareService = inject(PlainspaceShareService);

  readonly T = T;

  // Get data directly from services instead of inputs
  activeWorkContextTitle = toSignal(this._workContextService.activeWorkContextTitle$);
  activeWorkContextTypeAndId = toSignal(
    this._workContextService.activeWorkContextTypeAndId$,
  );
  // Full active context — drives the header icon (icon value, theme/tag color,
  // emoji detection). Mirrors the side-nav treatment for visual consistency.
  activeWorkContext = toSignal(this._workContextService.activeWorkContext$);

  // Whether the active project is shared on Plainspace — drives the visible
  // "Open in Plainspace" header button. Uses the same shared-detection selector
  // as the Collaborate-on-Plainspace menu entry. False for tags/special
  // sections, so the button stays project-only.
  isSharedOnPlainspace = toSignal(
    this._workContextService.activeWorkContextTypeAndId$.pipe(
      switchMap(({ activeId, activeType }) =>
        activeType === WorkContextType.PROJECT
          ? this._store.select(selectIsProjectSharedOnPlainspace(activeId))
          : of(false),
      ),
    ),
    { initialValue: false },
  );

  // Single source for the current URL path — all route-derived signals compute off this.
  // Query and fragment are stripped so end-anchored matchers work for e.g. `/config#plugins`.
  private _url$ = this._router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map((event) => event.urlAfterRedirects.split(/[?#]/, 1)[0]),
  );
  private _url = toSignal(this._url$, {
    initialValue: this._router.url.split(/[?#]/, 1)[0],
  });

  // Routes that get their own title and have no work-context menu.
  // Order is irrelevant — patterns are mutually exclusive end-anchors.
  private static readonly _ROUTE_TITLE_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
    [/schedule$/, T.MH.SCHEDULE],
    [/planner$/, T.MH.PLANNER],
    [/boards$/, T.MH.BOARDS],
    [/habits$/, T.MH.HABITS],
    [/search$/, T.MH.SEARCH],
    [/scheduled-list$/, T.MH.ALL_PLANNED_LIST],
    [/donate$/, T.MH.DONATE],
    [/config$/, T.PS.GLOBAL_SETTINGS],
    [/archived-projects$/, T.MH.ARCHIVED_PROJECTS],
  ];

  private _routeTitleKey = computed(
    () => PageTitleComponent._ROUTE_TITLE_KEYS.find(([re]) => re.test(this._url()))?.[1],
  );

  isSpecialSection = computed(() => !!this._routeTitleKey());
  isWorkViewPage = computed(() => /tasks$/.test(this._url()));

  displayTitle = computed(() => {
    const key = this._routeTitleKey();
    return key ? this._translateService.instant(key) : this.activeWorkContextTitle();
  });

  // Icon shown next to the title, defaulting the same way the nav does
  // (`list_alt` for projects, `label` for tags) when none is set.
  contextIcon = computed<string>(() => {
    const wc = this.activeWorkContext();
    if (!wc) {
      return DEFAULT_PROJECT_ICON;
    }
    const defaultIcon = wc.type === WorkContextType.TAG ? 'label' : DEFAULT_PROJECT_ICON;
    return wc.icon || defaultIcon;
  });

  isContextEmojiIcon = computed<boolean>(() => isSingleEmoji(this.contextIcon()));

  // Same color rule as the side nav: tag color wins, else the theme primary;
  // null (inherit) when neither is set. Emoji ignore the color anyway.
  contextIconColor = computed<string | null>(() => {
    const wc = this.activeWorkContext();
    if (!wc) {
      return null;
    }
    if (wc.type === WorkContextType.TAG) {
      // `color` lives on Tag only; WorkContext doesn't surface it in its type.
      const tagColor = (wc as { color?: string | null }).color;
      if (tagColor) {
        return tagColor;
      }
    }
    return wc.theme?.primary || null;
  });

  private _isXxxs$ = this._breakpointObserver.observe('(max-width: 350px)');
  isXxxs = toSignal(this._isXxxs$.pipe(map((result) => result.matches)), {
    initialValue: false,
  });

  get kb(): KeyboardConfig {
    return (this._configService.cfg()?.keyboard as KeyboardConfig) || {};
  }

  openInPlainspace(): void {
    const active = this.activeWorkContextTypeAndId();
    if (active) {
      void this._plainspaceShareService.openProjectOnPlainspace(active.activeId);
    }
  }
}
