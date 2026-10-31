import { getByPath } from './get-by-path.util';

describe('getByPath', () => {
  it('reads a top-level field', () => {
    expect(getByPath({ title: 'A' }, 'title')).toBe('A');
  });

  it('reads a nested field', () => {
    expect(getByPath({ status: { name: 'Open' } }, 'status.name')).toBe('Open');
  });

  it('returns undefined when a step is missing', () => {
    expect(getByPath({ status: null }, 'status.name')).toBeUndefined();
    expect(getByPath({}, 'author.displayName')).toBeUndefined();
  });

  it('returns undefined for a null or undefined root', () => {
    expect(getByPath(null, 'title')).toBeUndefined();
    expect(getByPath(undefined, 'title')).toBeUndefined();
  });
});
