import { findAdjacentFocusable } from './find-adjacent-focusable';

describe('findAdjacentFocusable', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'find-adjacent-focusable-root';
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  const setupTree = (): {
    headerA: HTMLElement;
    taskA1: HTMLElement;
    taskA2: HTMLElement;
    subA2: HTMLElement;
    headerB: HTMLElement;
    taskB1: HTMLElement;
  } => {
    root.innerHTML = `
      <collapsible class="is-group">
        <div class="collapsible-header" id="hA"></div>
        <task id="tA1"></task>
        <task id="tA2">
          <task id="sA2"></task>
        </task>
      </collapsible>
      <collapsible class="is-group">
        <div class="collapsible-header" id="hB"></div>
        <task id="tB1"></task>
      </collapsible>
    `;
    return {
      headerA: root.querySelector('#hA')!,
      taskA1: root.querySelector('#tA1')!,
      taskA2: root.querySelector('#tA2')!,
      subA2: root.querySelector('#sA2')!,
      headerB: root.querySelector('#hB')!,
      taskB1: root.querySelector('#tB1')!,
    };
  };

  const SELECTOR =
    '#find-adjacent-focusable-root task, #find-adjacent-focusable-root collapsible.is-group > .collapsible-header';

  it('returns next match when from is in the list', () => {
    const { taskA1, taskA2 } = setupTree();
    expect(findAdjacentFocusable(taskA1, 'next', SELECTOR)).toBe(taskA2);
  });

  it('returns prev match when from is in the list', () => {
    const { headerA, taskA1 } = setupTree();
    expect(findAdjacentFocusable(taskA1, 'prev', SELECTOR)).toBe(headerA);
  });

  it('crosses group boundary forward (last sub-task → next group header)', () => {
    const { subA2, headerB } = setupTree();
    expect(findAdjacentFocusable(subA2, 'next', SELECTOR)).toBe(headerB);
  });

  it('crosses group boundary backward (first task → current group header)', () => {
    const { taskB1, headerB } = setupTree();
    expect(findAdjacentFocusable(taskB1, 'prev', SELECTOR)).toBe(headerB);
  });

  it('walks past sub-tasks in document order', () => {
    const { taskA2, subA2 } = setupTree();
    // taskA2 is the parent; subA2 is its child and immediately follows in DOM
    expect(findAdjacentFocusable(taskA2, 'next', SELECTOR)).toBe(subA2);
  });

  it('returns null at the start of the list', () => {
    const { headerA } = setupTree();
    expect(findAdjacentFocusable(headerA, 'prev', SELECTOR)).toBeNull();
  });

  it('returns null at the end of the list', () => {
    const { taskB1 } = setupTree();
    expect(findAdjacentFocusable(taskB1, 'next', SELECTOR)).toBeNull();
  });

  it('returns null when from does not match the selector', () => {
    setupTree();
    const outsider = document.createElement('div');
    root.insertBefore(outsider, root.firstChild);
    expect(findAdjacentFocusable(outsider, 'next', SELECTOR)).toBeNull();
  });
});
