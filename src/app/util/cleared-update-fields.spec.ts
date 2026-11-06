import { applyClearedFields, clearedFieldsProps } from './cleared-update-fields';

interface TestEntity {
  id: string;
  a?: number;
  b?: string;
}

describe('clearedFieldsProps', () => {
  it('should list keys whose value is undefined', () => {
    expect(clearedFieldsProps<TestEntity>({ a: undefined, b: 'x' })).toEqual({
      clearedFields: ['a'],
    });
  });

  it('should return no prop at all when nothing is cleared', () => {
    expect(clearedFieldsProps<TestEntity>({ b: 'x' })).toEqual({});
    expect(clearedFieldsProps<TestEntity>({})).toEqual({});
  });
});

describe('applyClearedFields', () => {
  it('should restore undefined for listed keys dropped by JSON serialization', () => {
    const changes = JSON.parse(
      JSON.stringify({ a: undefined, b: 'x' }),
    ) as Partial<TestEntity>;
    expect('a' in changes).toBe(false);

    const restored = applyClearedFields(changes, ['a']);
    expect('a' in restored).toBe(true);
    expect(restored.a).toBeUndefined();
    expect(restored.b).toBe('x');
  });

  it('should return changes unchanged without clearedFields', () => {
    const changes: Partial<TestEntity> = { b: 'x' };
    expect(applyClearedFields(changes, undefined)).toBe(changes);
    expect(applyClearedFields(changes, [])).toBe(changes);
  });

  it('should tolerate junk from the wire and never clear id', () => {
    const changes: Partial<TestEntity> = { b: 'x' };
    expect(
      applyClearedFields(changes, 'nope' as unknown as (keyof TestEntity & string)[]),
    ).toBe(changes);

    const restored = applyClearedFields(changes, [
      'id',
      42,
    ] as unknown as (keyof TestEntity & string)[]);
    expect('id' in restored).toBe(false);
    expect(restored).toEqual({ b: 'x' });
  });

  it('should ignore non-identifier keys and cap the list (wire hardening)', () => {
    // A hostile/corrupt clearedFields from a plaintext provider must not
    // inject arbitrary own keys — non-identifier keys would persist through
    // typia (excess props pass), re-upload, and self-amplify.
    const changes: Partial<TestEntity> = { b: 'x' };
    const restored = applyClearedFields(changes, [
      '__proto__x!',
      'a b',
      'x'.repeat(100),
      '',
      'a',
    ] as unknown as (keyof TestEntity & string)[]);
    expect(Object.keys(restored)).toEqual(['b', 'a']);
    expect(restored.a).toBeUndefined();

    const flood = Array.from(
      { length: 200 },
      (_, i) => `f${i}`,
    ) as unknown as (keyof TestEntity & string)[];
    const capped = applyClearedFields({}, flood);
    expect(Object.keys(capped).length).toBeLessThanOrEqual(32);
  });
});
