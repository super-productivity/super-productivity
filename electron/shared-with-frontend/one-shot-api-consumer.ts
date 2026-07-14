/**
 * Creates a preload API consumer whose capability is returned exactly once.
 * Trusted startup code claims the capability before untrusted plugin code runs.
 */
export const createOneShotApiConsumer = <T>(factory: () => T): (() => T | null) => {
  let isConsumed = false;

  return () => {
    if (isConsumed) {
      return null;
    }

    isConsumed = true;
    return factory();
  };
};
