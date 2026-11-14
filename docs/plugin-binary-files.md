# Binary file saving for plugins

`saveBinaryFile` complements the text-based `downloadFile`. It preserves the
original bytes and distinguishes cancellation, saving to disk, and a browser
download request. It is available in `plugin.js` and through the iframe API.
Feature-detect it on older clients:
`typeof PluginAPI.saveBinaryFile === 'function'`.

## Contract

```typescript
const result = await PluginAPI.saveBinaryFile({
  filename: 'Документ.pdf',
  data: bytes, // ArrayBuffer, up to 10 MiB
  openAfterSave: true,
});
```

`filename` contains a single filename of up to 180 characters. Directories,
URLs, commands, control characters, trailing dots, and trailing spaces are not
allowed. The input request must not contain a `path` field. Validation runs in
the renderer and again in Electron main. The method does not change the task
format, synchronization, or data model.

| Result                       | Meaning                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `kind: 'canceled'`           | The user canceled the native dialog; the method neither writes nor opens a file.            |
| `kind: 'saved'`              | Electron wrote the original bytes to the selected file; `path` is the dialog result.        |
| `kind: 'download-requested'` | A download was requested from the browser. Actual saving and the file location are unknown. |

For `saved`, `openStatus` reports a separate outcome:

| `openStatus`    | Meaning                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `not-requested` | The plugin did not request opening.                                                                                     |
| `requested`     | The OS accepted the open request without reporting an error. Application launch and document display are not confirmed. |
| `blocked`       | The application forbids opening the selected file type. The file has already been saved.                                |
| `failed`        | The OS reported an error or rejected the request. The saved file remains on disk.                                       |

In the browser, `openStatus` is `unavailable` if the plugin requested opening,
or `not-requested` otherwise. The browser API does not promise to launch a
system application.

## Safety and waiting limits

1. The user selects the path in Electron's native dialog. The input request
   cannot open an arbitrary existing path.
2. Main copies the bytes before waiting for the user's choice and writes them
   after selection. A write failure does not trigger opening. An opening failure
   does not delete the file.
3. Main validates the actual filename from the dialog. The user may have changed
   `.pdf` to `.exe`. The shared `isPathSafeToOpen` and
   `hasExecutableFileExtension` checks apply independently of a plugin's own
   extension policy.
4. Executable filenames consisting of an extension alone, such as `.cmd` and
   `.exe`, are also blocked. An ordinary `.gitignore` is not an executable type.
5. While a dialog or opening operation is pending, a second binary call is
   rejected. It does not create another dialog. There are no automatic retries.
6. The iframe does not apply the usual 30-second API timeout to this method.
   The user may take longer to select a path. Closing the plugin view does not
   prove that the native operation was canceled; check the selected save
   location before retrying manually.

```text
ArrayBuffer → validate → native dialog → write → saved result
                                                   ↓
                         validate actual path → OS open request
```

The method does not log filenames, paths, or content. The original
`downloadFile(filename, text)` method retains its existing contract.

## Reproducing the checks

- `node --test electron/save-plugin-binary-file.test.cjs electron/open-url.test.cjs`
  tests real writes of synthetic bytes with dialog and shell fixtures.
  These tests do not launch OS applications.
- `npm run quiet -- test:file src/app/plugins/plugin-file-download.spec.ts --include src/app/plugins/plugin-api.spec.ts --include src/app/plugins/util/plugin-iframe.util.spec.ts --include src/app/ui/is-external-url-allowed.spec.ts`
  tests the browser Blob, direct API, iframe, a delayed result after 66 seconds,
  the normal timeout for other APIs, and the shared extension restrictions.
- `npm --prefix packages/plugin-api run typecheck` checks the public types.
- `npm run electron:build` checks main and preload.

For platform acceptance, test the native dialog and file associations
separately in an isolated profile. The `requested` outcome retains its limited
meaning after those checks.
