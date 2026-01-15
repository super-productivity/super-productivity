export const fixNumberField = (value: unknown, defaultValue?: number): number => {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsedValue = parseFloat(value);
    if (!isNaN(parsedValue)) {
      return parsedValue;
    }
  }
  return typeof defaultValue === 'number' ? defaultValue : 0;
};
