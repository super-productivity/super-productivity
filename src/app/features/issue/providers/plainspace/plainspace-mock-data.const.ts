import { PlainspaceIssue } from './plainspace-issue.model';
import { PLAINSPACE_MOCK_CURRENT_USER_ID } from './plainspace.const';

/**
 * In-memory mock space tasks for the prototype (see PLAINSPACE_USE_MOCK). A mix
 * of tasks assigned to "me", unassigned, and assigned to others, so the issue
 * pipeline (mine/unassigned → backlog) and the "assigned to others" panel can
 * both be exercised without a live backend.
 */
export const PLAINSPACE_MOCK_ISSUES: PlainspaceIssue[] = [
  {
    id: 'ps-101',
    title: 'Finalize the shared-space invite flow',
    isDone: false,
    assigneeId: PLAINSPACE_MOCK_CURRENT_USER_ID,
    assignee: { id: PLAINSPACE_MOCK_CURRENT_USER_ID, name: 'Me' },
    updatedAt: '2026-06-15T08:00:00.000Z',
    url: 'https://plainspace.org/demo/ps-101',
  },
  {
    id: 'ps-102',
    title: 'Triage incoming space feedback',
    isDone: false,
    assigneeId: null,
    assignee: null,
    updatedAt: '2026-06-15T09:30:00.000Z',
    url: 'https://plainspace.org/demo/ps-102',
  },
  {
    id: 'ps-103',
    title: 'Design the onboarding empty-state illustration',
    isDone: false,
    assigneeId: 'u-mara',
    assignee: { id: 'u-mara', name: 'Mara' },
    updatedAt: '2026-06-14T16:45:00.000Z',
    url: 'https://plainspace.org/demo/ps-103',
  },
  {
    id: 'ps-104',
    title: 'Set up the staging deploy pipeline',
    isDone: true,
    assigneeId: 'u-jon',
    assignee: { id: 'u-jon', name: 'Jon' },
    updatedAt: '2026-06-13T11:15:00.000Z',
    url: 'https://plainspace.org/demo/ps-104',
  },
];
