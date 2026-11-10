/**
 * Wrap a plugin's API so `revoke()` turns every method into a no-op once the
 * plugin is unloaded — leaked plugin code (timers, listeners) must not keep
 * creating tasks, notifications or node calls after disable/uninstall.
 *
 * A revoked method returns a promise that never settles instead of throwing:
 * a throw or rejection from a leaked timer would surface in the global error
 * handler on every tick, and returning `undefined` would trip TypeErrors in
 * `await api.getTasks()` style code. A pending promise just halts it quietly.
 * `onBlocked` is called once per method name.
 */
export const withRevocableApi = <T extends object>(
  api: T,
  onBlocked: (member: string) => void,
): { api: T; revoke: () => void } => {
  let isRevoked = false;
  const blocked = new Set<string>();
  const revocable = new Proxy(api, {
    get: (target, prop) => {
      const value: unknown = Reflect.get(target, prop);
      if (!isRevoked || typeof value !== 'function') {
        return value;
      }
      return (): Promise<never> => {
        const member = String(prop);
        if (!blocked.has(member)) {
          blocked.add(member);
          onBlocked(member);
        }
        return new Promise<never>(() => undefined);
      };
    },
  });
  return {
    api: revocable,
    revoke: () => {
      isRevoked = true;
    },
  };
};
