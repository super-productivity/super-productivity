import Step from 'shepherd.js/src/types/step';
import { nextOnObs, twoWayObs, waitForEl, waitForElObs$ } from './shepherd-helper';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskService } from '../tasks/task.service';
import { delay, filter, first, map, switchMap } from 'rxjs/operators';
import { Actions, ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { GlobalConfigState } from '../config/global-config.model';
import { IS_MOUSE_PRIMARY } from '../../util/is-mouse-primary';
import { NavigationEnd, Router } from '@angular/router';
import { promiseTimeout } from '../../util/promise-timeout';
import { hideAddTaskBar } from '../../core-ui/layout/store/layout.actions';
import { LS } from '../../core/persistence/storage-keys.const';
import { KeyboardConfig } from '../config/keyboard-config.model';
import { WorkContextService } from '../work-context/work-context.service';
import { ShepherdService } from './shepherd.service';
import { fromEvent, merge, of, timer } from 'rxjs';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';

const PRIMARY_CLASSES =
  'mdc-button mdc-button--unelevated mat-mdc-unelevated-button mat-primary mat-mdc-button-base';
const SECONDARY_CLASSES =
  'mdc-button mdc-button--unelevated mat-mdc-unelevated-button mat-mdc-button-base';

const NEXT_BTN = {
  classes: PRIMARY_CLASSES,
  text: 'Next',
  type: 'next',
};

const CANCEL_BTN: any = (shepherdService: ShepherdService) => ({
  classes: SECONDARY_CLASSES,
  text: 'No thanks',
  action: () => {
    const checkbox = document.getElementById(
      'tour-show-on-startup-checkbox',
    ) as HTMLInputElement;
    if (checkbox && !checkbox.checked) {
      localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
    }
    shepherdService.complete();
  },
});

const CLICK = IS_MOUSE_PRIMARY ? '<em>click</em>' : '<em>tap</em>';
const CLICK_B = IS_MOUSE_PRIMARY ? '<em>Click</em>' : '<em>Tap</em>';

export enum TourId {
  Welcome = 'Welcome',
  AddTask = 'AddTask',
  DeleteTask = 'DeleteTask',
  Sync = 'Sync',
  Projects = 'Projects',
  ProductivityHelper = 'ProductivityHelper',
  IssueProviders = 'IssueProviders',
  FinishDay = 'FinishDay',
  StartTourAgain = 'StartTourAgain',
  KeyboardNav = 'KeyboardNav',
  FinalCongrats = 'FinalCongrats',
  XXX = 'XXX',
}

const HIDE_QUICK = (shepherdService: ShepherdService): Step.StepOptionsWhen => ({
  show: () => {
    setTimeout(() => {
      shepherdService.next();
    }, 800);
  },
});

export const SHEPHERD_STEPS = (
  shepherdService: ShepherdService,
  cfg: GlobalConfigState,
  actions$: Actions,
  layoutService: LayoutService,
  taskService: TaskService,
  router: Router,
  workContextService: WorkContextService,
): Array<Step.StepOptions> => {
  const KEY_COMBO = (action: keyof KeyboardConfig): string =>
    `<kbd>${cfg.keyboard[action]}</kbd>`;

  return [
    // ------------------------------
    {
      id: TourId.Welcome,
      title: 'Welcome to Super Productivity! 🚀',
      text: `<p>Super Productivity is a ToDo List / Time Tracker app.</p>
        <p>Do you want a quick tour of the most important features?</p>
        <p style="margin-top: 12px;">
          <label style="display: flex; align-items: center; cursor: pointer; user-select: none;">
            <input
              type="checkbox"
              id="tour-show-on-startup-checkbox"
              checked
              style="margin-right: 8px; cursor: pointer;"
            />
            <span style="opacity: 0.9; font-size: 0.8em;">Show tour on startup</span>
          </label>
        </p>`,
      buttons: [
        CANCEL_BTN(shepherdService),
        {
          ...NEXT_BTN,
          text: "Let's go!",
          action: () => {
            const checkbox = document.getElementById(
              'tour-show-on-startup-checkbox',
            ) as HTMLInputElement;
            if (checkbox && !checkbox.checked) {
              localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
            }
            shepherdService.next();
          },
        },
      ],
    },
    {
      id: TourId.AddTask,
      title: "Let's add your first task! ⚡",
      text: IS_MOUSE_PRIMARY
        ? `<em>Click</em> on this button or press ${KEY_COMBO('addNewTask')}.`
        : '<em>Tap</em> on the button with the +',
      attachTo: {
        element: '.tour-addBtn',
        on: 'bottom',
      },
      when: nextOnObs(
        layoutService.isShowAddTaskBar$.pipe(filter((v) => v)),
        shepherdService,
        () => {
          router.navigate(['/']);
        },
      ),
    },
    {
      title: 'Enter a title!',
      text: 'Enter the title you want to give your task and hit the <kbd>Enter</kbd> key.',
      attachTo: {
        element: 'add-task-bar',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(200),
      when: twoWayObs(
        { obs: actions$.pipe(ofType(TaskSharedActions.addTask)) },
        {
          obs: merge(actions$.pipe(ofType(hideAddTaskBar))),
        },
        shepherdService,
        // 'A',
      ),
    },
    {
      title: 'Close the Add Task Bar!',
      text: IS_MOUSE_PRIMARY
        ? 'Press the <kbd>Escape</kbd> key or <em>click</em> anywhere on the backdrop to leave the add task bar.'
        : '<em>Tap</em> anywhere on the grayed out backdrop to leave the add task bar.',
      attachTo: {
        element: 'add-task-bar',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(200),
      when: twoWayObs(
        { obs: actions$.pipe(ofType(hideAddTaskBar)) },
        {
          obs: workContextService.mainListTasks$.pipe(filter((tt) => tt.length < 1)),
          backToId: TourId.AddTask,
        },
        shepherdService,
        // 'B',
      ),
    },
    {
      title: 'Congrats! 🎉 This is your first task!',
      text: "Let's start tracking time to it!",
      attachTo: {
        element: 'task',
        on: 'bottom' as any,
      },
      when: twoWayObs(
        { obs: timer(4000) },
        {
          obs: workContextService.mainListTasks$.pipe(filter((tt) => tt.length < 1)),
          backToId: TourId.AddTask,
        },
        shepherdService,
        // 'C',
      ),
      beforeShowPromise: () => promiseTimeout(200),
    },

    {
      title: 'Time Tracking ⏱️',
      text: '<p>Pressing the play button in the top right corner will start your first time tracking session.</p><p>Time tracking is useful as it allows you to get a better idea on how you spend your time. It will enable you to make better estimates and can improve how you work.</p>',
      attachTo: {
        element: '.tour-playBtn',
        on: 'bottom',
      },
      when: twoWayObs(
        { obs: taskService.currentTaskId$.pipe(filter((id) => !!id)) },
        {
          obs: workContextService.mainListTasks$.pipe(filter((tt) => tt.length < 1)),
          backToId: TourId.AddTask,
        },
        shepherdService,
        // 'D',
      ),
    },
    {
      title: 'Stop Tracking Time',
      text: `To stop tracking ${CLICK} on the pause button.`,
      attachTo: {
        element: '.tour-playBtn',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(500),
      when: twoWayObs(
        {
          obs: taskService.currentTaskId$.pipe(
            filter((id) => !id),
            delay(100),
          ),
        },
        {
          obs: workContextService.mainListTasks$.pipe(filter((tt) => tt.length < 1)),
          backToId: TourId.AddTask,
        },
        shepherdService,
        // 'E',
      ),
    },
    ...(IS_MOUSE_PRIMARY
      ? [
          {
            title: 'Task Hover Menu',
            text: 'There is more you can do with a task. Hover over the task you created with your mouse again.',
            attachTo: {
              element: 'task',
              on: 'bottom' as any,
            },
            when: twoWayObs(
              {
                obs: waitForElObs$('task.shepherd-highlight .hover-controls'),
              },
              {
                obs: workContextService.mainListTasks$.pipe(
                  filter((tt) => tt.length < 1),
                ),
                backToId: TourId.AddTask,
              },
              shepherdService,
              // 'F',
            ),
          },
          {
            title: 'Open Task Details',
            attachTo: {
              element: '.show-additional-info-btn',
              on: 'bottom' as any,
            },
            text: 'You can open a panel with additional controls by <em>clicking</em> on the button.',
            when: twoWayObs(
              {
                obs: taskService.selectedTask$.pipe(
                  filter((selectedTask) => !!selectedTask),
                ),
              },
              {
                obs: merge(
                  workContextService.mainListTasks$.pipe(filter((tt) => tt.length < 1)),
                  of(true).pipe(
                    switchMap(() => {
                      const btnEl = document.querySelector(
                        '.show-additional-info-btn.shepherd-highlight',
                      );
                      if (btnEl) {
                        const taskEl = (btnEl as HTMLElement).closest('task .first-line');
                        return fromEvent(taskEl as HTMLElement, 'mouseleave');
                      }
                      return of(true);
                    }),
                  ),
                ),
              },
              shepherdService,
              // 'G',
            ),
          },
        ]
      : [
          {
            title: 'Task Details',
            text: 'There is more you can do with tasks. Tap on the task.',
            attachTo: {
              element: 'task',
              on: 'bottom' as any,
            },
            when: twoWayObs(
              {
                obs: taskService.selectedTask$.pipe(
                  filter((selectedTask) => !!selectedTask),
                ),
              },
              {
                obs: workContextService.mainListTasks$.pipe(
                  filter((tt) => tt.length < 1),
                ),
                backToId: TourId.AddTask,
              },
              shepherdService,
              // 'H',
            ),
          },
        ]),
    {
      title: 'The Task Details',
      attachTo: {
        element: 'task-detail-panel',
        on: IS_MOUSE_PRIMARY ? 'left' : 'top',
      },
      text: `<p>This is the task detail panel. Here you can:</p><ul>
<li>adjust estimates</li>
<li>schedule your task</li>
<li>add notes or attachments</li>
<li>configure your task to be repeated</li>
<li>and view issue data for issue tasks (more about that later)</li>
</ul>`,
      buttons: [{ ...NEXT_BTN, text: 'Cool!' }],
      beforeShowPromise: () => promiseTimeout(500),
    },
    {
      title: 'Closing the Task Details',
      text: IS_MOUSE_PRIMARY
        ? 'You can close the panel by <em>clicking</em> on the button with the <span class="material-icons">chevron_right</span> icon. Do this now!'
        : 'You can close the panel by <em>tapping</em> on the darker backdrop in the top or dragging the panel handle to the very bottom. Do this now!',
      attachTo: {
        element: '.tour-edge-close-handle',
        on: 'bottom',
      },
      when: nextOnObs(
        taskService.selectedTask$.pipe(filter((selectedTask) => !selectedTask)),
        shepherdService,
      ),
    },
    ...(IS_MOUSE_PRIMARY
      ? [
          {
            title: 'Edit Task Title',
            text: '<p>You can edit the task title by <em>clicking</em> on it. Do this now and change the task title to something else.</p>',
            attachTo: {
              element: '.task-title',
              on: 'bottom' as any,
            },
            beforeShowPromise: () => promiseTimeout(500),
            when: nextOnObs(
              actions$.pipe(ofType(TaskSharedActions.updateTask)),
              shepherdService,
            ),
          },
          {
            title: 'Well done!  🎉',
            attachTo: {
              element: 'task',
              on: 'bottom' as any,
            },
            when: HIDE_QUICK(shepherdService),
          },
        ]
      : []),

    // ------------------
    ...(IS_MOUSE_PRIMARY
      ? [
          {
            title: 'Marking tasks as done',
            text: '<p>You can mark tasks as done by <em>hovering</em> over it and then <em>clicking</em> the <span class="material-icons">check</span> icon. Do this now!</p>',
            attachTo: {
              element: '.tour-undoneList task',
              on: 'bottom' as any,
            },
            when: nextOnObs(
              actions$.pipe(
                ofType(TaskSharedActions.updateTask),
                filter(({ task }) => !!task.changes.isDone),
              ),
              shepherdService,
            ),
          },
        ]
      : [
          {
            title: 'Marking tasks as done',
            text: '<p>You can mark tasks as done by swiping them to the right</p><p>Swiping to the left will open up the schedule Dialog.</p><p><em>Swipe right</em> now to mark the task as done!</p>',
            attachTo: {
              element: '.tour-undoneList task',
              on: 'bottom' as any,
            },
            when: nextOnObs(
              actions$.pipe(
                ofType(TaskSharedActions.updateTask),
                filter(({ task }) => !!task.changes.isDone),
              ),
              shepherdService,
            ),
          },
          {
            title: 'Marking tasks as undone',
            text: '<p>You can mark tasks as undone again by swiping it to the right</p>',
            attachTo: {
              element: '.tour-doneList task',
              on: 'bottom' as any,
            },
            beforeShowPromise: () => promiseTimeout(500),
            when: nextOnObs(
              actions$.pipe(
                ofType(TaskSharedActions.updateTask),
                filter(({ task }) => task.changes.isDone === false),
              ),
              shepherdService,
            ),
          },
        ]),
    // ------------------------------
    {
      id: TourId.DeleteTask,
      title: 'Deleting a Task',
      text: IS_MOUSE_PRIMARY
        ? // eslint-disable-next-line max-len
          `To delete a task you need to open the task context menu. To do so right <em>click</em> on it (or long press on Mac and Mobile) and select "<strong>Delete Task</strong>".`
        : 'To delete a task you need to open the task context menu. To do so long press and select "<strong>Delete Task</strong>" in the menu that opens up.',
      attachTo: {
        element: 'task',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(300),
      when: (() => {
        let intId: number;
        return {
          show: () => {
            intId = waitForEl('.mat-menu-panel', () => {
              shepherdService.hide();
            });
            actions$
              .pipe(ofType(TaskSharedActions.deleteTask), first())
              .subscribe(() => shepherdService.next());
          },
          hide: () => {
            // NOTE this is the exception since we use hide as part of the flow
            // _onDestroy$.complete();
            window.clearInterval(intId);
          },
        };
      })(),
    },
    {
      title: 'Excellent!  🎉',
      when: HIDE_QUICK(shepherdService),
    },

    // ------------------------------
    {
      id: TourId.Projects,
      title: 'Projects',
      text: `If you have lots of tasks, you probably need more than a single task list. One way of creating different lists is by using projects. You can find projects in the menu ${IS_ANDROID_WEB_VIEW ? '(<span class="material-icons">menu</span>)' : 'on the left'}.`,
      buttons: [{ ...NEXT_BTN, text: 'Good to know!' }],
    },

    // ------------------------------
    ...(IS_MOUSE_PRIMARY
      ? [
          {
            id: TourId.IssueProviders,
            beforeShowPromise: () => router.navigate(['tag/TODAY/tasks']),
            title: 'Issue Integrations & Calendars',
            text: 'You can import tasks from a variety of third party tools. To do so click on this icon <span class="material-icons">dashboard_customize</span> in the top right corner.',
            attachTo: {
              element: '.tour-issuePanelTrigger',
              on: 'bottom' as any,
            },
            when: nextOnObs(
              layoutService.isShowIssuePanel$.pipe(filter((v) => !!v)),
              shepherdService,
            ),
          },
          {
            title: 'Issue Integrations & Calendars',
            text: 'To configure an issue provider or calendar, click on one of the buttons in the panel. But for now, lets continue.',
            buttons: [{ ...NEXT_BTN, text: 'Alright!' }],
          },
        ]
      : []),

    // ------------------------------
    {
      id: TourId.Sync,
      title: 'Data Privacy & Syncing 🔒',
      text: '<p><strong>Super Productivity does NOT collect any data.</strong> There are no user accounts or registration required.</p><p>This means you are in full control of your data. You can choose to save it locally or sync it with a provider of your choice (like Dropbox, WebDAV, or a local file).</p>',
      buttons: [{ ...NEXT_BTN, text: 'Great!' }],
    },
    {
      title: 'Syncing & Data Privacy',
      text: '<p>With Super Productivity <strong>you can save and sync your data with a cloud provider of your choice</strong> or even host it in your own cloud.</p><p>Let me show you where to configure this!!</p>',
      buttons: [{ ...NEXT_BTN, text: "Let's go!" }],
    },
    // Only show "Open menu" step on mobile where menu is hidden
    ...(layoutService.isShowMobileBottomNav()
      ? [
          {
            title: 'Configure Sync',
            attachTo: {
              element: '.tour-burgerTrigger',
              on: 'bottom' as any,
            },
            beforeShowPromise: () => router.navigate(['']),
            text: 'Open the menu (<span class="material-icons">menu</span>)',
            when: {
              show: () => {
                // TODO better implementation
                setTimeout(() => shepherdService.next(), 8000);
              },
            },
          },
        ]
      : []),
    {
      title: 'Configure Sync',
      text: `${CLICK_B} on <span class="material-icons">settings</span> <strong>Settings</strong>!`,
      attachTo: {
        element: '.tour-settingsMenuBtn',
        on: 'top',
      },
      beforeShowPromise: () => {
        // Navigate to home first on desktop since we skipped the menu step
        if (!layoutService.isShowMobileBottomNav()) {
          return router.navigate(['']);
        }
        return Promise.resolve();
      },
      when: nextOnObs(
        router.events.pipe(
          filter((event: any) => event instanceof NavigationEnd),
          map((event) => !!event.url.includes('config')),
          filter((v) => !!v),
        ),
        shepherdService,
        // make sure we are not on config page already
      ),
    },
    {
      title: 'Configure Sync',
      text: `Scroll down and ${CLICK} to expand the <strong>Sync</strong> Section`,
      attachTo: {
        element: '.tour-syncSection',
        on: 'top',
      },
      scrollTo: true,
      when: twoWayObs(
        {
          obs: waitForElObs$('.tour-isSyncEnabledToggle'),
        },
        {
          obs: router.events.pipe(
            filter((event: any) => event instanceof NavigationEnd),
            map((event) => !event.url.includes('config')),
            filter((v) => !!v),
          ),
        },
        shepherdService,
      ),
    },
    {
      title: 'Configure Sync',
      attachTo: {
        element: '.tour-syncSection',
        on: 'top',
      },
      text: '<p>Here you should be able to configure a sync provider of your choosing. For most people <a href="https://www.dropbox.com/" target="_blank"><strong>Dropbox</strong></a> is probably the easiest solution, that also will offer you automatic backups in the cloud.</p><p>If you have the desktop or Android version of Super Productivity <strong>LocalFile</strong> is another good option. It will let you configure a file path to sync to. You can then sync this file with any provider you like.</p><p>The option <strong>WebDAV</strong> can be used to sync with Nextcloud and others.</p>',
      buttons: [NEXT_BTN],
    },
    {
      title: 'Configure Sync',
      text: 'This covers syncing. If you have any questions you can always ask them <a href="https://github.com/super-productivity/super-productivity/discussions">on the projects GitHub page</a>. ',
      buttons: [NEXT_BTN],
    },

    // ------------------------------
    {
      id: TourId.ProductivityHelper,
      when: {
        show: () => {
          router.navigate(['config']).then(() => {
            shepherdService.next();
          });
        },
      },
    },
    {
      title: 'Productivity Helper',
      // eslint-disable-next-line max-len
      text: `Another thing you might want to check out is the <strong>Productivity Helper</strong> section. Here you can configure a variety of little tools to your needs.`,
      beforeShowPromise: () => promiseTimeout(500),
      attachTo: {
        element: '.tour-productivityHelper',
        on: 'top',
      },
      scrollTo: true,
      buttons: [{ ...NEXT_BTN, text: 'Will do!' }],
    },

    // ------------------------------
    {
      id: TourId.FinalCongrats,
      title: '🎉 Congratulations! 🎉',
      text: '<p>This concludes the tour. Remember that you can always start it again via the Help button in the menu.</p><p>Best way to get familiar with the app, is to play around with it. Have fun! 😄</p>',
      buttons: [
        ...(IS_MOUSE_PRIMARY
          ? [
              {
                text: 'Tour Keyboard Shortcuts',
                classes: PRIMARY_CLASSES,
                action: () => {
                  shepherdService.show(TourId.KeyboardNav);
                  localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
                },
              } as any,
            ]
          : []),
        {
          text: 'End Tour',
          classes: PRIMARY_CLASSES,
          action: () => {
            shepherdService.complete();
            localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
          },
        } as any,
      ],
    },

    // ------------------------------
    {
      id: TourId.StartTourAgain,
      title: 'Show again?',
      text: 'Do you want to show the tour again the next time you start the app? You can always show the tour again via the help button in the left menu.',
      when: {
        show: () => {
          if (localStorage.getItem(LS.IS_SKIP_TOUR)) {
            shepherdService.complete();
          }
        },
      },
      buttons: [
        {
          text: 'Never again',
          classes: SECONDARY_CLASSES,
          action: () => {
            localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
            shepherdService.complete();
          },
        } as any,
        {
          text: 'Again next time',
          classes: PRIMARY_CLASSES,
          action: () => {
            localStorage.removeItem(LS.IS_SKIP_TOUR);
            shepherdService.complete();
          },
        } as any,
      ],
    },

    // ------------------------------
    {
      id: TourId.KeyboardNav,
      title: 'Keyboard Navigation',
      // eslint-disable-next-line max-len
      text: `<p>The most efficient way to use Super Productivity is to make use of the keyboard shortcuts. Don't worry there just a handful of important ones :)</p><p>You can configure most of them under <strong>Settings/Keyboard Shortcuts</strong>, but let's start more practical.</p>`,
      buttons: [NEXT_BTN],
    },
    {
      title: 'Keyboard Navigation',
      text: `Let's add a couple of tasks. Press ${KEY_COMBO('addNewTask')}.`,
      when: nextOnObs(
        layoutService.isShowAddTaskBar$.pipe(filter((v) => v)),
        shepherdService,
      ),
    },
    {
      title: 'Enter a title!',
      text: 'Enter the title you want to give your task and hit the <kbd>Enter</kbd> key. <strong>Do this a couple of times until you have at least 4 tasks with different titles</strong>.',
      attachTo: {
        element: 'add-task-bar',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(200),
      when: twoWayObs(
        {
          obs: actions$.pipe(
            ofType(TaskSharedActions.addTask),
            switchMap(() =>
              workContextService.mainListTasks$.pipe(
                filter((tasks) => tasks.length >= 4),
              ),
            ),
          ),
        },
        { obs: actions$.pipe(ofType(hideAddTaskBar)) },
        shepherdService,
      ),
    },
    {
      title: 'Close the Add Task Bar!',
      text: 'Press the <kbd>Escape</kbd> key to leave the add task bar.',
      attachTo: {
        element: 'add-task-bar',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(200),
      when: nextOnObs(
        actions$.pipe(ofType(hideAddTaskBar)),
        // delay because other hide should trigger first
        shepherdService,
      ),
    },
    {
      title: 'A focused task',
      text: 'Do you see the <span class="shepherd-colored-border">colored border</span> around the first task? This means the task is focused. To unfocus it click somewhere else in the document.',
      when: {
        show: () => taskService.focusFirstTaskIfVisible(),
      },
      buttons: [NEXT_BTN],
    },
    {
      title: 'Focussing Tasks',
      text: `If you lost focus you can always use the ${KEY_COMBO(
        'goToWorkView',
      )} key to go to the main list view and focus the first task.`,
      buttons: [NEXT_BTN],
    },
    {
      title: 'Moving around',
      // eslint-disable-next-line max-len
      text: `<p>When a task is focused you can navigate to other tasks by pressing the arrow keys <kbd>↑</kbd> and <kbd>↓</kbd>.</p>`,
      when: {
        show: () => taskService.focusFirstTaskIfVisible(),
      },
      buttons: [NEXT_BTN],
      attachTo: {
        element: 'task-list',
        on: 'bottom',
      },
      highlightClass: '',
    },
    {
      title: 'Moving tasks around',
      text: `You can move the focused task itself around by pressing ${KEY_COMBO(
        'moveTaskUp',
      )} and ${KEY_COMBO('moveTaskDown')}.`,
      when: {
        show: () => taskService.focusFirstTaskIfVisible(),
      },
      buttons: [NEXT_BTN],
      attachTo: {
        element: 'task-list',
        on: 'bottom',
      },
      highlightClass: '',
    },
    {
      title: 'Edit Task Title',
      text: `You can edit the task by pressing the <kbd>Enter</kbd>.`,
      when: {
        show: () => taskService.focusFirstTaskIfVisible(),
      },
      buttons: [NEXT_BTN],
      attachTo: {
        element: 'task-list',
        on: 'bottom',
      },
      highlightClass: '',
    },
    {
      title: 'Open, close and navigate the Task Details',
      // eslint-disable-next-line max-len
      text: `<p>You can open the task details panel for a task by pressing <kbd>→</kbd> while it is focused.</p><p>You can close it again by pressing <kbd>←</kbd>.</p><p>You can also navigate and activate its items by using the arrow keys <kbd>→</kbd> <kbd>↑</kbd> and <kbd>↓</kbd>.</p><p>You can leave most contexts that open up this way by pressing <kbd>Escape</kbd>.</p>`,
      when: {
        show: () => taskService.focusFirstTaskIfVisible(),
      },
      buttons: [NEXT_BTN],
      attachTo: {
        element: 'task-list',
        on: 'bottom',
      },
      highlightClass: '',
    },
    {
      title: 'More Task Shortcuts',
      when: {
        show: () => taskService.focusFirstTaskIfVisible(),
      },
      // eslint-disable-next-line max-len
      text: `<p>There are more task related shortcuts that can be used when a task is focused. Best you check them all out under <strong>Settings/Keyboard Shortcuts/Tasks</strong>. The most useful are probably:</p>
          <ul>
          <li>${KEY_COMBO('taskSchedule')}: Schedule task</li>
          <li>${KEY_COMBO('taskDelete')}: Delete Task</li>
          <li>${KEY_COMBO('taskToggleDone')}: Toggle done</li>
          <li>${KEY_COMBO('taskAddSubTask')}: Add new sub task</li>
          <li>${KEY_COMBO('taskAddAttachment')}: Attach a file or link to the task</li>
          <li>${KEY_COMBO('togglePlay')}: Toggle tracking</li>
          </ul>

      `,
      buttons: [NEXT_BTN],
      attachTo: {
        element: 'task-list',
        on: 'bottom',
      },
      highlightClass: '',
    },
    {
      title: '🎉 Congratulations! 🎉',
      text: '<p>This concludes the keyboard navigation tour. Remember that you can always start it again via the Help button in the menu.</p><p>Best way to get familiar with the app, is to play around with it. Have fun! 😄</p>',
      buttons: [
        {
          text: 'End Tour',
          classes: PRIMARY_CLASSES,
          action: () => {
            shepherdService.complete();
          },
        } as any,
      ],
    },
  ];
};
