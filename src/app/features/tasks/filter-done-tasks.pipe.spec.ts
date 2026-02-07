import { filterDoneTasks, FilterDoneTasksPipe } from './filter-done-tasks.pipe';

describe('FilterDoneTasksPipe', () => {
  it('create an instance', () => {
    const pipe = new FilterDoneTasksPipe();
    expect(pipe).toBeTruthy();
  });
});

describe('filterDoneTasks()', () => {
  it('should filter all', () => {
    const r = filterDoneTasks(['xyz'] as any, null, false, true);
    expect(r).toEqual([]);
  });

  it('should filter done', () => {
    const r = filterDoneTasks(
      [{ isDone: true }, { isDone: false }, { isDone: true }] as any,
      null,
      true,
      false,
    );
    expect(r).toEqual([jasmine.objectContaining({ isDone: false })]);
  });

  it('should filter all but current', () => {
    const r = filterDoneTasks(
      [{ id: 'CURRENT' }, { id: '1' }, { id: '2' }, { id: '3' }] as any,
      'CURRENT',
      false,
      true,
    );
    expect(r).toEqual([jasmine.objectContaining({ id: 'CURRENT' })]);
  });

  it('should not filter', () => {
    const r = filterDoneTasks(
      [{ isDone: true }, { isDone: false }, { isDone: true }] as any,
      null,
      false,
      false,
    );
    expect(r).toEqual([
      jasmine.objectContaining({ isDone: true }),
      jasmine.objectContaining({ isDone: false }),
      jasmine.objectContaining({ isDone: true }),
    ]);
  });
});
