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

export const TriggerTimeBased: IAutomationTrigger = {
  id: 'timeBased',
  name: 'Time Based',
  matches: (event) => event.type === 'timeBased',
};
