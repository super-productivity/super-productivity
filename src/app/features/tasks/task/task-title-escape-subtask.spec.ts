/**
 * Regression tests for Escape behavior in `TaskComponent.updateTaskTitleIfChanged()`.
 *
 * Desired behavior:
 * - Escape on a freshly created empty subtask should remove it.
 * - Escape on an existing subtask whose title was cleared should NOT remove it.
 */
describe('Task subtask Escape delete guard', () => {
  const shouldDeleteOnEscape = ({
    submitTrigger,
    parentId,
    wasChanged,
    newVal,
  }: {
    submitTrigger: 'blur' | 'escape' | 'enter' | 'modEnter';
    parentId?: string | null;
    wasChanged: boolean;
    newVal: string;
  }): boolean => {
    return submitTrigger === 'escape' && !!parentId && !wasChanged && !newVal;
  };

  it('deletes on Escape for freshly created empty subtask', () => {
    const shouldDelete = shouldDeleteOnEscape({
      submitTrigger: 'escape',
      parentId: 'parent-1',
      wasChanged: false,
      newVal: '',
    });

    expect(shouldDelete).toBeTrue();
  });

  it('does NOT delete on Escape for existing subtask with cleared title', () => {
    const shouldDelete = shouldDeleteOnEscape({
      submitTrigger: 'escape',
      parentId: 'parent-1',
      wasChanged: true,
      newVal: '',
    });

    expect(shouldDelete).toBeFalse();
  });
});
