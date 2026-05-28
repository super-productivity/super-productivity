import {
  appendTaskComment,
  createTaskComment,
  removeTaskCommentFromList,
  sortTaskCommentsByCreated,
  updateTaskCommentInList,
  wasTaskCommentEdited,
} from './task-comment.util';

describe('task-comment.util', () => {
  it('should sort comments by created ascending', () => {
    const sorted = sortTaskCommentsByCreated([
      { id: 'b', body: 'b', created: 2 },
      { id: 'a', body: 'a', created: 1 },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('should create and append comments', () => {
    const comment = createTaskComment('  hello  ');
    expect(comment?.body).toBe('hello');
    const list = appendTaskComment(undefined, 'second');
    expect(list?.length).toBe(1);
  });

  it('should update and detect edited comments', () => {
    const list = [{ id: 'cmt-1', body: 'one', created: 1000 }];
    const updated = updateTaskCommentInList(list, 'cmt-1', 'ONE');
    expect(updated?.[0].body).toBe('ONE');
    expect(updated?.[0].updated).toBeGreaterThan(1000);
    expect(wasTaskCommentEdited(updated![0])).toBe(true);
  });

  it('should remove the last comment and return undefined', () => {
    const list = appendTaskComment(undefined, 'only')!;
    expect(removeTaskCommentFromList(list, list[0].id)).toBeUndefined();
  });
});
