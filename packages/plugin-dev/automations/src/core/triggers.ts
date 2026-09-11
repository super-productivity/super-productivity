import { IAutomationTrigger } from './definitions';

export const TriggerTaskCompleted: IAutomationTrigger = {
  id: 'taskCompleted',
  name: 'Task Completed',
  matches: (event) => event.type === 'taskCompleted',
};

export const TriggerTaskCreated: IAutomationTrigger = {
  id: 'taskCreated',
  name: 'Task Created',
  matches: (event) => event.type === 'taskCreated',
};

export const TriggerTaskUpdated: IAutomationTrigger = {
  id: 'taskUpdated',
  name: 'Task Updated',
  matches: (event) => event.type === 'taskUpdated',
};

export const TriggerTaskStarted: IAutomationTrigger = {
  id: 'taskStarted',
  name: 'Task Started',
  description:
    'Fires when the timer starts for a task. Switching to a different task also fires this for the new task (and Task Stopped for the previous one).',
  matches: (event) => event.type === 'taskStarted',
};

export const TriggerTaskStopped: IAutomationTrigger = {
  id: 'taskStopped',
  name: 'Task Stopped',
  description:
    'Fires when the timer is paused/stopped for a task (without completing it). Switching to a different task also fires this for the previous task.',
  matches: (event) => event.type === 'taskStopped',
};

export const TriggerTimeBased: IAutomationTrigger = {
  id: 'timeBased',
  name: 'Time Based',
  matches: (event) => event.type === 'timeBased',
};

export const TriggerShortcut: IAutomationTrigger = {
  id: 'shortcut',
  name: 'Keyboard Shortcut',
  description:
    'Fires when the keyboard shortcut assigned to this rule is pressed. Assign the key in Settings > Keyboard Shortcuts. Actions apply to the task row currently focused in the app.',
  matches: (event) => event.type === 'shortcut',
};
