/**
 * Exhaustiveness guard for discriminated unions / enums. Place in the `default`
 * of a `switch` (or the `else` of a chain) over a closed union: TypeScript
 * resolves `x` to `never` only when every case is handled, so adding a new
 * member to the union turns the call into a COMPILE error — the missing branch
 * is caught before it can silently fall through at runtime.
 *
 * Throws if reached at runtime (a malformed value bypassing the type system),
 * so it doubles as a runtime assertion.
 */
export const assertNever = (x: never): never => {
  throw new Error(`Unexpected value: ${JSON.stringify(x)}`);
};
