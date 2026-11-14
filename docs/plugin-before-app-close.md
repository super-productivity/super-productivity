# Awaited plugin exit callback

`onBeforeAppClose(handler | null): Promise<boolean>` is available in `plugin.js`
and mounted iframes. It registers one callback per execution instance.
Registering again replaces the callback. `null` removes the registration. Electron
returns `true`; the browser returns `false`. The method may be absent on older
hosts, so plugins must check for it before calling it.

## Execution order

```text
Exit request → ordinary before-close participants → plugin finalizers → close
                      sync and confirmation
```

`ExecBeforeCloseService` stores the IDs before notifying subscribers.
Finalizers start after all ordinary participants confirm completion through
`setDone`. Removing an ordinary participant stops it from blocking this phase.
If the user cancels exit in the finish-day dialog or opens the daily summary,
that participant cancels the current coordinator attempt without native DONE.
Later settings changes and removal of an ordinary participant do not resume a
cancelled attempt. A new explicit exit request creates a new attempt. Minimizing
the window, hiding a tab and minimizing to the tray do not trigger this API.

The main process uses one internal `PLUGIN_BEFORE_CLOSE_ID` and the existing
REGISTER/UNREGISTER/BEFORE_CLOSE_DONE messages. Plugins do not receive arbitrary
IPC methods. The callback does not confirm successful synchronization: ordinary
sync may finish with a handled error. Before deleting external data, the plugin
must verify its own published request and a consistent snapshot.

## Deadline and recovery

All finalizers run in parallel within a shared 15-second window. The deadline
starts after the ordinary participants finish. The callback receives
`{ deadlineAt, signal }`:

- `deadlineAt` is an absolute Unix timestamp in milliseconds;
- `signal` is a local `AbortSignal`, which the host aborts when the deadline
  expires, the registration is removed or the phase ends;
- a rejection, exception or unsettled promise cannot retain the plugin ID after
  the deadline. This bounds the plugin phase, not the entire normal sync/dialog.

```js
const supported = await plugin.onBeforeAppClose?.(async ({ deadlineAt, signal }) => {
  await saveDurableJob();
  while (!signal.aborted && Date.now() < deadlineAt) {
    const operation = await nextRevalidatedOperation();
    if (!operation || signal.aborted || Date.now() >= deadlineAt) break;
    await performOperation(operation, { signal });
  }
});
```

The example illustrates the contract; the plugin supplies the queue functions.
It persists intent before a network action. Aborting fetch does not prove that
the server did not execute an already-issued DELETE. After application startup,
the plugin checks the state and resumes the unfinished operation. Hundreds of
files do not require waiting for the entire queue to finish before exit.

Awaiting a promise cannot interrupt a synchronous infinite loop in the renderer.
A process crash, forced termination or power loss cannot guarantee callback
delivery. In the browser, the host does not try to await network work on unload
or treat `visibilitychange` as exit. The plugin implements recovery on next start.

## Direct and iframe callbacks

A background callback works even when the plugin page is closed. `PluginRunner`
removes its registration during teardown and failed initialization. The runner
removes the API and ready/unload callbacks; stale API calls are ignored.
An iframe registration lasts only until that iframe is destroyed, including
navigation and closing an embedded panel. Use `plugin.js` to keep the callback
registered without an open view.

The function and AbortSignal are not sent through structured clone. The iframe
keeps its callback locally. The host proxy sends a request ID and deadline, then
awaits a separate BEFORE_CLOSE_RESULT. Responses are checked against the source,
token, generation and request ID. The host installs its listener before sending
the event. Ordinary iframe API calls remain available during the callback, so
it can await, for example, `getTasks()` or `loadPersistedData()`.

Registration is acknowledged immediately. It does not wait for a future exit
through the ordinary 30-second API timeout. The callback has its own absolute
deadline and cancellation event; teardown removes listeners and pending proxies.
The existing `onUnload` remains synchronous, with its result not awaited.

## Verification

Focused Angular specs: `before-close-coordinator.spec.ts`,
`plugin-before-close.spec.ts`, `plugin-before-close-iframe.spec.ts`,
`plugin-api.spec.ts`, `plugin-runner.spec.ts`,
`plugin-index.component.spec.ts`, `sync-effects-routing.spec.ts` and
`finish-day-before-close.effects.spec.ts`. They cover ordering, exit cancellation,
deadline, teardown, nested API calls and the iframe boundary. Real Electron quit
requires a separate isolated acceptance test.
