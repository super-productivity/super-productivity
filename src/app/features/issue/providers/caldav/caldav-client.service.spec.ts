import { CaldavClientService } from './caldav-client.service';

describe('CaldavClientService._getParentRelatedTo', () => {
  const getParentRelatedTo = (todo: unknown): string | undefined =>
    (CaldavClientService as any)._getParentRelatedTo(todo);

  const makeTodo = (
    relProps: { value: string; reltype?: string }[],
  ): { getAllProperties: (name: string) => unknown[] } => ({
    getAllProperties: (_name: string) =>
      relProps.map((p) => ({
        getParameter: (param: string) =>
          param === 'reltype' ? (p.reltype ?? null) : null,
        getFirstValue: () => p.value,
      })),
  });

  it('should return UID when RELTYPE is absent (defaults to PARENT per RFC 5545)', () => {
    expect(getParentRelatedTo(makeTodo([{ value: 'parent-uid' }]))).toBe('parent-uid');
  });

  it('should return UID when RELTYPE=PARENT', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'parent-uid', reltype: 'PARENT' }])),
    ).toBe('parent-uid');
  });

  it('should return UID when RELTYPE=parent (case-insensitive)', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'parent-uid', reltype: 'parent' }])),
    ).toBe('parent-uid');
  });

  it('should ignore RELTYPE=CHILD and return undefined', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'child-uid', reltype: 'CHILD' }])),
    ).toBeUndefined();
  });

  it('should ignore RELTYPE=SIBLING and return undefined', () => {
    expect(
      getParentRelatedTo(makeTodo([{ value: 'sibling-uid', reltype: 'SIBLING' }])),
    ).toBeUndefined();
  });

  it('should skip CHILD/SIBLING and return the first PARENT in a mixed list', () => {
    expect(
      getParentRelatedTo(
        makeTodo([
          { value: 'sibling-uid', reltype: 'SIBLING' },
          { value: 'child-uid', reltype: 'CHILD' },
          { value: 'parent-uid', reltype: 'PARENT' },
        ]),
      ),
    ).toBe('parent-uid');
  });

  it('should return undefined when there are no RELATED-TO properties', () => {
    expect(getParentRelatedTo(makeTodo([]))).toBeUndefined();
  });

  it('should return undefined when RELATED-TO value is empty string', () => {
    expect(getParentRelatedTo(makeTodo([{ value: '' }]))).toBeUndefined();
  });
});
