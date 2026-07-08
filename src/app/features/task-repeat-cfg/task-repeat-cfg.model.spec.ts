import { DEFAULT_TASK_REPEAT_CFG } from './task-repeat-cfg.model';

describe('DEFAULT_TASK_REPEAT_CFG', () => {
  it('keeps skipOverdue false as the safe baseline', () => {
    // The model default is intentionally the OFF baseline: it is what fixtures
    // and any non-dialog spread inherit, and OFF can never silently drop a
    // missed occurrence. The real, schedule-aware default for newly created
    // configs (ON only for a plain everyday schedule) is seeded at creation by
    // getDefaultSkipOverdue — see get-default-skip-overdue.ts. Pinned so a
    // future change cannot quietly flip this to a blanket default.
    expect(DEFAULT_TASK_REPEAT_CFG.skipOverdue).toBe(false);
  });
});
