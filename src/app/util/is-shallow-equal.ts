export const isShallowEqual = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean => {
  const keys1 = Object.keys(a);
  const keys2 = Object.keys(b);
  if (keys1.length !== keys2.length) {
    return false;
  }
  for (const key of keys1) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
};
