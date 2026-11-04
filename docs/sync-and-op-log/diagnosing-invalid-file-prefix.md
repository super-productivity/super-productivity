# Diagnosing `InvalidFilePrefixError` (#9627)

A downloaded sync file must start with the header `pf_[C][E]<modelVersion>__`
(`C` = compressed, `E` = encrypted). When it does not, the client throws
`InvalidFilePrefixError`, and the OpLog history (what a user sends as a log
export) records three fields chosen to answer one question in a single
round-trip: **was this a bad RESPONSE (server/proxy) or a bad STORED FILE?**

The fields are shapes only — never the file's bytes. The head of a sync file
is user data.

## Decode table

| Field       | Value    | Read as                                                                                                                                                                                                                                                                                       |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefixAt`  | `-1`     | Header gone entirely. Heuristic: a head that lost only its first byte also reads `-1`.                                                                                                                                                                                                        |
| `prefixAt`  | `>= 0`   | Header present but damaged, or pushed to that offset by prepended junk.                                                                                                                                                                                                                       |
| `headShape` | `markup` | Bad RESPONSE: proxy or captive-portal HTML, WebDAV multistatus.                                                                                                                                                                                                                               |
| `headShape` | `base64` | Consistent with our own ciphertext/gzip body missing its header — a STORED-FILE problem. **Not proof**: any long alphanumeric body reads the same; weigh `inputLength` and the provider.                                                                                                      |
| `headShape` | `json`   | **Ambiguous — do not read as "bad response".** Encryption and compression are both off by default, so an unencrypted stored body IS raw JSON. Resolve with the reporter's sync settings: with encryption or compression ON their body would be `base64`, so `json` then points at a response. |
| `headShape` | `other`  | Unrecognized or too short to classify (`Unauthorized`, `nginx`). Check `inputLength`.                                                                                                                                                                                                         |

`headShape` cannot separate a head-strip from a larger fragment (both read
`base64`); nothing local knows the file's expected size.

## Ownership

The interface doc on `SyncFilePrefixInvalidPrefixDetails`
(`packages/sync-core/src/sync-file-prefix.ts`) is normative; this table is a
triage summary. The claims are pinned by executable specs: classification in
`packages/sync-core/tests/sync-file-prefix.spec.ts`, per-config body shape
against the real encoder in
`src/app/op-log/encryption/encrypt-and-compress-handler.service.spec.ts`, and
the OpLog bridge in `src/app/op-log/util/sync-file-prefix.spec.ts`.

Recovery: `SyncWrapperService` surfaces the corrupted-remote snack with a
force-overwrite action (shared with `JsonParseError`) — EXCEPT for
`headShape: 'markup'`, which points at a bad response rather than a bad stored
file: there the snack explains the likely server/proxy/login cause and offers
no overwrite action, because force-uploading over a healthy remote file to
"fix" a transient response would lose the other devices' data. If the markup
really is the stored file (e.g. WebDAV persisted an error page), the manual
escape hatch is Sync settings → Force overwrite remote
(`DialogSyncCfgComponent`), which never re-reads the bad file. `.bak`
auto-recovery for this error is parked in #9682 — a head-strip is not a
torn-write shape — with explicit merge criteria recorded there.
