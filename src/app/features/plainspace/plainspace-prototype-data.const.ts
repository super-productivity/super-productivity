import { PlainspaceSharedTask } from './plainspace-shared-task.model';

/**
 * Hard-coded sample data for the UI-only prototype of the "Assigned to others"
 * panel. Replace with live `PlainspaceSharedTasksService` data once the
 * Plainspace API is wired up (see docs/plainspace-integration-plan.md).
 */
export const PLAINSPACE_PROTOTYPE_ASSIGNED_TO_OTHERS: PlainspaceSharedTask[] = [
  {
    id: 'ps-demo-1',
    title: 'Design the onboarding empty-state illustration',
    isDone: false,
    assignee: { id: 'u-mara', name: 'Mara' },
    url: 'https://plainspace.org/demo/ps-demo-1',
  },
  {
    id: 'ps-demo-2',
    title: 'Write API docs for the spaces endpoint',
    isDone: false,
    assignee: { id: 'u-mara', name: 'Mara' },
    url: 'https://plainspace.org/demo/ps-demo-2',
  },
  {
    id: 'ps-demo-3',
    title: 'Set up the staging deploy pipeline',
    isDone: true,
    assignee: { id: 'u-jon', name: 'Jon' },
    url: 'https://plainspace.org/demo/ps-demo-3',
  },
  {
    id: 'ps-demo-4',
    title: 'Review pull request #482 (sync conflict edge case)',
    isDone: false,
    assignee: { id: 'u-jon', name: 'Jon' },
    url: 'https://plainspace.org/demo/ps-demo-4',
  },
];
