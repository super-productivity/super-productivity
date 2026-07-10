import { getReorderedSubTaskIds } from './get-reordered-sub-task-ids';
import { arrayMoveLeft, arrayMoveToStart } from '../../../util/array-move';

describe('getReorderedSubTaskIds', () => {
  it('applies the move function when id is a member of subTaskIds', () => {
    expect(getReorderedSubTaskIds(['a', 'b', 'c'], 'b', arrayMoveLeft)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('returns null when subTaskIds is undefined (parent not found)', () => {
    expect(getReorderedSubTaskIds(undefined, 'a', arrayMoveToStart)).toBeNull();
  });

  it('returns null when id is not a member of subTaskIds (wrong parent)', () => {
    expect(getReorderedSubTaskIds(['a', 'b'], 'missing', arrayMoveToStart)).toBeNull();
  });

  it('returns null for an empty subTaskIds list', () => {
    expect(getReorderedSubTaskIds([], 'a', arrayMoveToStart)).toBeNull();
  });
});
