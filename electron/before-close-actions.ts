type CloseActionResult = 'ignore' | 'wait' | 'notify' | 'quit';

interface BeforeCloseActions {
  pendingIds: ReadonlySet<string>;
  register: (id: string, isConfirmation: boolean) => void;
  unregister: (id: string) => void;
  start: () => string[];
  complete: (id: string) => CloseActionResult;
}

export const createBeforeCloseActions = (): BeforeCloseActions => {
  const pendingIds = new Set<string>();
  const confirmationIds = new Set<string>();
  let requestedConfirmations = new Set<string>();

  return {
    pendingIds,
    register: (id: string, isConfirmation: boolean): void => {
      pendingIds.add(id);
      if (isConfirmation) {
        confirmationIds.add(id);
      }
    },
    unregister: (id: string): void => {
      pendingIds.delete(id);
      confirmationIds.delete(id);
    },
    start: (): string[] => {
      requestedConfirmations = new Set(confirmationIds);
      return [...(requestedConfirmations.size > 0 ? requestedConfirmations : pendingIds)];
    },
    complete: (id: string): CloseActionResult => {
      // A confirmation already shown can complete after its setting is disabled.
      const wasConfirmation = requestedConfirmations.delete(id);
      if (!pendingIds.delete(id) && !wasConfirmation) {
        return 'ignore';
      }
      confirmationIds.delete(id);
      if (pendingIds.size === 0) {
        return 'quit';
      }
      return wasConfirmation && confirmationIds.size === 0 ? 'notify' : 'wait';
    },
  };
};
