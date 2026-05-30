import { resolveDisplayTagIds } from './resolve-display-tag-ids.util';
import { Task } from '../task.model';

const t = (tagIds: string[] | undefined): Pick<Task, 'tagIds'> => ({
  tagIds: tagIds as string[],
});

describe('resolveDisplayTagIds', () => {
  it('returns own tagIds when the task has any', () => {
    expect(resolveDisplayTagIds(t(['own']), t(['parent']))).toEqual(['own']);
  });

  it('falls back to parent tagIds when own is empty', () => {
    expect(resolveDisplayTagIds(t([]), t(['parent']))).toEqual(['parent']);
  });

  it('falls back to parent tagIds when own is undefined', () => {
    expect(resolveDisplayTagIds(t(undefined), t(['parent']))).toEqual(['parent']);
  });

  it('returns empty array when neither task nor parent has tags', () => {
    expect(resolveDisplayTagIds(t([]), t(undefined))).toEqual([]);
    expect(resolveDisplayTagIds(t(undefined), undefined)).toEqual([]);
  });

  it('returns own tagIds when no parent is supplied', () => {
    expect(resolveDisplayTagIds(t(['own']))).toEqual(['own']);
  });
});
