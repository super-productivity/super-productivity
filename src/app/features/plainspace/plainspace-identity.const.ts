/**
 * Mock identity of "me" used while `PLAINSPACE_USE_MOCK` is true. Kept in the
 * plainspace feature folder (not the issue-provider folder) so both the issue
 * provider's mock data and `PlainspaceAccountService` can share it without a
 * cross-folder import cycle.
 */
export const PLAINSPACE_MOCK_CURRENT_USER_ID = 'ps-me';
