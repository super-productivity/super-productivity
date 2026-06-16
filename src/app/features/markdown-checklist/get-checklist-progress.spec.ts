import { getChecklistProgress } from './get-checklist-progress';

describe('getChecklistProgress', () => {
  it('should return null for empty/undefined notes', () => {
    expect(getChecklistProgress(undefined)).toBeNull();
    expect(getChecklistProgress(null)).toBeNull();
    expect(getChecklistProgress('')).toBeNull();
  });

  it('should return null for plain notes without checklist items', () => {
    expect(getChecklistProgress('Just some notes\nwith two lines')).toBeNull();
  });

  it('should count done and total for a full checklist', () => {
    const notes = '- [ ] one\n- [x] two\n- [ ] three';
    expect(getChecklistProgress(notes)).toEqual({ done: 1, total: 3 });
  });

  it('should report all done when every item is checked', () => {
    const notes = '- [x] one\n- [x] two';
    expect(getChecklistProgress(notes)).toEqual({ done: 2, total: 2 });
  });

  it('should report zero done for a fresh checklist', () => {
    const notes = '- [ ] one\n- [ ] two\n- [ ] three';
    expect(getChecklistProgress(notes)).toEqual({ done: 0, total: 3 });
  });

  it('should count checklist items mixed with prose (>=2 items heuristic)', () => {
    // isMarkdownChecklist treats >=2 checkbox lines as a checklist even with prose
    const notes = 'Some intro text\n- [x] one\n- [ ] two';
    expect(getChecklistProgress(notes)).toEqual({ done: 1, total: 2 });
  });
});
