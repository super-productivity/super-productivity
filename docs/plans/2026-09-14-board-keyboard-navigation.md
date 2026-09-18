# Board keyboard navigation and selection

## Design

- Reuse `PlannerTaskComponent` for card shortcuts, selection styling and task
  actions. An optional `TASK_CARD_LIST` injection token delegates navigation,
  reordering and adjacent-panel moves to the containing board panel. Planner
  behavior remains the default; cards do not import Boards.
- `BoardPanelComponent` owns its visible order and a shared placement method for
  keyboard moves and drag/drop. `BoardComponent` coordinates adjacent panels via
  component outputs and view queries, including empty destinations. Horizontal
  navigation uses rendered panel positions and never wraps between grid rows.
- Keep selection as transient task IDs. Remember the rendered anchor as well,
  because the same task can occur in multiple panels. Range selection and
  select-all stay within a panel; modifier-click can select across panels.
- Arrow keys navigate; configured move-up/down/top/bottom shortcuts reorder a
  manual panel. Ctrl+Shift+Left/Right moves the focused task, or the selection
  when it includes that task, to the visually adjacent panel. Group moves,
  reordering and dragging require every selected task to be present in the source
  panel; mixed-panel selections do not move. Sorted panels accept moves
  but do not allow manual reordering. Empty panels expose their add button.
- Panel placement retains filter semantics: apply destination tags, project,
  completion, scheduling and backlog rules. Source membership is not exclusive.
  Resolve a required schedule once before changing tasks; cancellation cancels
  placement. Reuse normal persistent task actions and one panel-order update,
  retaining existing effects and per-entity conflict boundaries. Yield after
  bulk dispatch and suppress repeated task feedback. No schema change.
- Restore focus within the originating panel after ordinary task actions, and
  into the destination after an explicit move. Clear selection on board changes.
  Reordering retains the focused task, including within a selection. Moving the
  first card up transfers it to the panel visually above, appending to its order.
  Moving the last card down prepends it to the panel visually below.
- On desktop, a board card click only focuses; double-click or Enter opens task
  details. Touch keeps tap-to-open outside selection mode. Planner is unchanged.

## Validation

Cover duplicate cards, panel-scoped ranges, navigation through empty panels,
single and selected reorder/moves, sorted panels, schedule cancellation, and
resulting task/order state. Run existing planner, selection, shortcut and board
tests, relevant browser coverage, TypeScript checks and required file checks.
