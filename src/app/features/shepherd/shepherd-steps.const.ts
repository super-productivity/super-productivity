import type Shepherd from 'shepherd.js';
type StepOptions = Shepherd.Step.StepOptions;
import { nextOnObs, twoWayObs } from './shepherd-helper';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskService } from '../tasks/task.service';
import { filter, switchMap } from 'rxjs/operators';
import { ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { GlobalConfigState } from '../config/global-config.model';
import { promiseTimeout } from '../../util/promise-timeout';
import { hideAddTaskBar } from '../../core-ui/layout/store/layout.actions';
import { KeyboardConfig } from '@sp/keyboard-config';
import { WorkContextService } from '../work-context/work-context.service';
import { ShepherdService } from './shepherd.service';
import { Observable } from 'rxjs';
import { Action } from '@ngrx/store';

const PRIMARY_CLASSES =
  'mdc-button mdc-button--unelevated mat-mdc-unelevated-button mat-primary mat-mdc-button-base';

const NEXT_BTN = {
  classes: PRIMARY_CLASSES,
  text: 'Next',
  type: 'next',
};

export enum TourId {
  CreateTask = 'CreateTask',
  KeyboardNav = 'KeyboardNav',
}

export const SHEPHERD_STEPS = (
  shepherdService: ShepherdService,
  cfg: GlobalConfigState,
  actions$: Observable<Action>,
  layoutService: LayoutService,
  taskService: TaskService,
  workContextService: WorkContextService,
): Array<StepOptions> => {
  const KEY_COMBO = (action: keyof KeyboardConfig): string =>
    `<kbd>${cfg.keyboard[action]}</kbd>`;

  return [
    {
      id: TourId.CreateTask,
      title: 'Create a task',
      text: [
        '<p>Tasks can be created from the Add Task Bar. ',
        'It also understands short syntax, so you can set useful details ',
        'while typing the task title.</p>',
      ].join(''),
      buttons: [
        {
          classes: PRIMARY_CLASSES,
          text: 'Open Add Task Bar',
          action: () => {
            layoutService.showAddTaskBar();
            window.setTimeout(() => shepherdService.next());
          },
        },
      ],
    },
    {
      title: 'Create a task',
      text: [
        'Try creating a task with a planned date and time estimate:<br><br>',
        '<code>Prepare demo @tomorrow 30m</code><br><br>',
        'Type it into the Add Task Bar and press <kbd>Enter</kbd>.',
      ].join(''),
      attachTo: {
        element: 'add-task-bar',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(200),
      when: twoWayObs(
        {
          obs: actions$.pipe(ofType(TaskSharedActions.addTask)),
        },
        { obs: actions$.pipe(ofType(hideAddTaskBar)) },
        shepherdService,
      ),
    },
    {
      title: 'Close the Add Task Bar',
      text: 'Press the <kbd>Escape</kbd> key to close the Add Task Bar.',
      attachTo: {
        element: 'add-task-bar',
        on: 'bottom',
      },
      beforeShowPromise: () => promiseTimeout(200),
      when: nextOnObs(actions$.pipe(ofType(hideAddTaskBar)), shepherdService),
    },
    {
      title: 'Short syntax',
      text: [
        '<p>The example title is cleaned up automatically. ',
        'With the default Short Syntax settings, ',
        '<code>@tomorrow</code> plans the task for tomorrow and ',
        '<code>30m</code> sets a 30 minute estimate.</p>',
        '<p>You can also use:</p>',
        '<ul>',
        '<li><code>#tag</code> to add a tag</li>',
        '<li><code>+project</code> to assign a project</li>',
        '<li><code>@friday</code> or <code>@16:00</code> to plan a task</li>',
        '<li><code>!friday</code> or <code>!14:30</code> to set a deadline</li>',
        '</ul>',
      ].join(''),
      buttons: [NEXT_BTN],
    },
    {
      title: 'Short syntax settings',
      text: '<p>You can enable or disable the individual short syntax options under <strong>Settings / Tasks / Short Syntax</strong>.</p><p>This how-to stays available from the Help menu whenever you want to try it again.</p>',
      buttons: [
        {
          text: 'End Tour',
          classes: PRIMARY_CLASSES,
          action: () => {
            shepherdService.complete();
          },
        },
      ],
    },
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
        },
      ],
    },
  ];
};
