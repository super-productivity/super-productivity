import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { TagComponent } from '../../../features/tag/tag/tag.component';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { expandFadeHorizontalAnimation } from '../../../ui/animations/expand.ani';
import { T } from '../../../t.const';
import { Task } from '../../../features/tasks/task.model';
import { WorkContext } from '../../../features/work-context/work-context.model';
import { NavigateToTaskService } from '../../navigate-to-task/navigate-to-task.service';

/**
 * The pill naming the tracked task.
 *
 * It reads as a label hanging off the play button that controls it: flush
 * against the action row and centred on the same line as the buttons.
 *
 * A child of the header wrapper rather than of the nav, which buys two things.
 * It is never inside `.action-nav-scroll` — the pill used to be
 * `position: absolute; right: 100%` off the play button, so inside a scroll
 * container it sat beyond the inline-start clip edge, and left-of-origin
 * overflow cannot be scrolled back (`scrollLeft` clamps at 0). An always-on
 * scroller did not hide the pill, it made it unreachable, which is what
 * reverted `0a95482e64`. And it does not teleport into the 48px vertical rail
 * with the nav, where a ~270px name has no room; in that mode it stays in the
 * header, as it did before the rail existed.
 *
 * It costs the action row nothing, by construction. The pill is absolutely
 * positioned inside `.pill-slot`, a `flex: 1 1 0` box that IS the row's
 * leftover space — so the pill contributes nothing to layout and cannot move a
 * button whether it is shown, hidden, short or long. Showing it is gated on a
 * container query against that same slot, which is a direct answer to "is
 * there room?" rather than the viewport guess it replaces.
 *
 * `max-width: min(100%, 520px)` keeps it inside the slack, so it can never
 * reach the title however long the task name is — which is also why the old
 * `:has(page-title:hover)` opacity hack is gone: the two can no longer collide.
 * As it runs out of room it gives up the project chip first and the name last.
 */
@Component({
  selector: 'tracked-task-pill',
  standalone: true,
  imports: [MatTooltip, TranslatePipe, TagComponent],
  template: `
    @if (currentTask(); as task) {
      <button
        @fade
        type="button"
        class="current-task-title"
        (click)="navigateToTask(task.id)"
        [attr.aria-label]="T.MH.SHOW_TRACKED_TASK | translate"
        matTooltip="{{ T.MH.SHOW_TRACKED_TASK | translate }}"
        matTooltipPosition="below"
      >
        <div class="title">{{ task.title }}</div>
        @if (currentTaskContext(); as taskContext) {
          <tag
            @expandFadeHorizontal
            [tag]="taskContext"
            class="project"
          ></tag>
        }
      </button>
    }
  `,
  styles: [
    `
      :host {
        display: contents;

        /* How far the pill's trailing end slides behind the play button. */
        --tracked-pill-tuck: 12px;
      }

      /* Nothing to tuck under once the nav has teleported into the vertical
         rail: the pill would pay a 20px trailing padding against an 8px leading
         one, visibly off-centre, and sit ~4px off the rail's edge. */
      :host-context(body.isVerticalActionBar) {
        --tracked-pill-tuck: 0px;
      }

      .current-task-title {
        display: flex;
        align-items: center;
        white-space: nowrap;

        /* A real button: it navigates to the tracked task, so it has to be
           reachable and activatable by keyboard and announced with a role.
           These reset the UA button styling that brings with it — everything
           visual below is unchanged. */
        appearance: none;
        border: none;
        color: inherit;
        font: inherit;
        text-align: start;

        /* WCAG 2.5.8: the content box is a 13px line plus 3px padding, which
           measured 23px. The Spacing exception cannot rescue it either, because
           the tuck below deliberately overlaps the play button's target. */
        min-height: 24px;

        /* Out of flow, inside .pill-slot. This is the guarantee that the pill
           can never move a button: it contributes nothing to the row's layout,
           so whether it is shown, hidden, short or long changes nothing about
           where the actions sit. */
        position: absolute;

        /* Centred on the button line. */
        top: 50%;
        transform: translateY(-50%);

        /* Tucked under the play button: the slot ends where the button starts,
           so a negative inset slides the pill's trailing end behind it.

           The button paints over the pill, which two independent facts both
           give us -- .pill-slot is a stacking context of its own (implied by
           container-type), and .play-btn separately carries z-index 6. Worth
           knowing that the second one lives in play-button's styles and exists
           for the pulse circle, not for this: if the overlap ever inverts,
           look there first. */
        inset-inline-end: calc(var(--tracked-pill-tuck) * -1);

        /* Never wider than the slack it was given, so it cannot reach the title
           however long the task name is. Capped in absolute terms too: past
           roughly this much, a longer name stops telling you anything you did
           not already know and just walks across the header. */
        max-width: min(100%, 520px);
        border: 1.5px solid var(--c-accent);
        border-radius: 10px;
        padding: calc(var(--s-half) * 0.75) var(--s);

        /* Pay the tuck back as padding. The trailing end of the pill is behind
           the play button, so without this the text runs under it instead of
           stopping short of it — the gap the reader sees on the right would be
           the declared padding MINUS the tuck, which is negative at these
           values. Adding the tuck keeps the visible gap equal to the left. */
        padding-inline-end: calc(var(--s) + var(--tracked-pill-tuck));
        background: var(--bg-lighter);
        font-size: 13px;
        cursor: pointer;
        /* visibility is in here on purpose: it is what makes the hide below
           fade rather than blink. display: none cannot be transitioned, and
           since the pill is out of flow it was never buying anything by being
           display:none anyway. */
        transition:
          opacity 0.3s ease-out,
          visibility 0.3s ease-out,
          background var(--transition-standard),
          border-color var(--transition-standard);

        /* Layered, not swapped. --state-hover is a translucent overlay token
           meant to sit ON a surface, so assigning it to background replaces the
           fill instead of tinting it and the pill LOSES its background on
           hover. On the themes that set --bg to transparent (liquid-glass, zen,
           velvet), or with a wallpaper, the desktop then shows through it. */
        &:hover {
          background-image: linear-gradient(var(--state-hover), var(--state-hover));
        }

        /* Sized by the leftover it was given. The slot IS the row's spare
           space, so this asks the question directly instead of inferring it
           from a viewport width — which is what the old 1080px cutoff got
           wrong, hiding the pill on windows that had space to spare while
           telling us nothing about the actual slack, which depends on the
           context name, the side nav and the right panel (#8818).

           Give up the project chip before the name. Both together used to go at
           once at 220px, which deleted a perfectly readable name and left a
           220px hole where it had been -- and with the notes panel open that
           happened on a 1300px window. The name is the thing worth keeping, so
           the chip yields first and the pill itself only goes when even a few
           characters will not fit. */
        @container header-pill-slot (max-width: 300px) {
          .project {
            display: none;
          }
        }

        @container header-pill-slot (max-width: 120px) {
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }

        /* Below the XS breakpoint the bottom nav owns the actions and the play
           button is the tracked-task affordance. A product decision rather than
           a fit one, so it stays a media query.

           599px, not 600px: LayoutService.isXs is max-width 599px and the
           vertical rail starts at min-width 600px, so a 600px window is
           desktop everywhere else. Written out because this block is inline
           styles in a .ts and so gets no Sass -- mq(xs, max) is the same
           number. */
        @media (max-width: 599px) {
          display: none;
        }

        /* No width of its own: it takes what the pill has after the chip, and
           ellipsizes there. A flat cap here used to truncate the name at 200px
           however much room the slot had -- measured, an 818px slot still
           showed "Investigate why the archive mig...", which is the pill
           failing at its only job. min-width: 0 because a flex item will not
           shrink below its content otherwise. */
        .title {
          min-width: 0;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        /* Yields nothing: the name absorbs the squeeze, and the chip is dropped
           whole once the pill gets tight (above). */
        .project {
          flex-shrink: 0;
          max-width: 130px;
          padding-right: 0;
          padding-left: var(--s-half);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;

          ::ng-deep .tag-title {
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
          }
        }
      }
    `,
  ],
  animations: [fadeAnimation, expandFadeHorizontalAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackedTaskPillComponent {
  private readonly _navigateToTaskService = inject(NavigateToTaskService);

  readonly T = T;

  readonly currentTask = input<Task | null>();
  readonly currentTaskContext = input<WorkContext | null>();

  navigateToTask(taskId: string): void {
    this._navigateToTaskService.navigate(taskId);
  }
}
