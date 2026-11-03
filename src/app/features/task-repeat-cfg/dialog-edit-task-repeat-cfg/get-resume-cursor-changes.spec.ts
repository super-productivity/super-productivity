import { getResumeCursorChanges } from './get-resume-cursor-changes';

describe('getResumeCursorChanges', () => {
  const YESTERDAY = '2026-07-01';
  const paused = { isPaused: true, lastTaskCreationDay: '2026-06-15' };

  it('moves the cursor to yesterday when a fixed schedule is resumed', () => {
    const changes = getResumeCursorChanges(
      paused,
      { isPaused: false, repeatFromCompletionDate: false },
      YESTERDAY,
    );
    expect(changes?.lastTaskCreationDay).toBe(YESTERDAY);
    expect(new Date(changes!.lastTaskCreation!).getDate()).toBe(1);
    expect(new Date(changes!.lastTaskCreation!).getHours()).toBe(12);
  });

  it('never moves the cursor back (today was already created)', () => {
    expect(
      getResumeCursorChanges(
        { isPaused: true, lastTaskCreationDay: '2026-07-02' },
        { isPaused: false },
        YESTERDAY,
      ),
    ).toBeNull();
    expect(
      getResumeCursorChanges(
        { isPaused: true, lastTaskCreationDay: YESTERDAY },
        { isPaused: false },
        YESTERDAY,
      ),
    ).toBeNull();
  });

  it('uses the legacy timestamp when there is no cursor day', () => {
    const changes = getResumeCursorChanges(
      { isPaused: true, lastTaskCreation: new Date(2026, 5, 15, 12).getTime() },
      { isPaused: false },
      YESTERDAY,
    );
    expect(changes?.lastTaskCreationDay).toBe(YESTERDAY);
  });

  it('leaves after-completion schedules alone (the cursor is their anchor)', () => {
    expect(
      getResumeCursorChanges(
        paused,
        { isPaused: false, repeatFromCompletionDate: true },
        YESTERDAY,
      ),
    ).toBeNull();
  });

  it('does nothing unless the series is resumed', () => {
    expect(getResumeCursorChanges(paused, { isPaused: true }, YESTERDAY)).toBeNull();
    expect(
      getResumeCursorChanges(
        { isPaused: false, lastTaskCreationDay: '2026-06-15' },
        { isPaused: false },
        YESTERDAY,
      ),
    ).toBeNull();
    expect(
      getResumeCursorChanges(
        { isPaused: false, lastTaskCreationDay: '2026-06-15' },
        { isPaused: true },
        YESTERDAY,
      ),
    ).toBeNull();
  });
});
