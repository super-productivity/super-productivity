// Numeric IDs for built-in start pages.
// String values of `MiscConfig.defaultStartPage` are treated as project IDs.
// Values are persisted in user config — do not change existing numbers.
export enum DefaultStartPage {
  Today = 0,
  Inbox = 1, // Legacy — new configs store INBOX_PROJECT.id as a string instead.
  Planner = 2,
  Schedule = 3,
  Boards = 4,
}
