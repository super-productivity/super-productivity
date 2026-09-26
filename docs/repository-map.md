# Repository content map

Use this map to choose the next files to read for a task. Read the matching row,
then the relevant constraints below; do not load every linked document. Paths are
entry points, not an exhaustive list of files to change. Follow imports, callers,
and nearby tests to verify the actual behavior before editing.

This map describes navigation only. [Agent instructions](../AGENTS.md) govern the
workflow, [accepted decisions](../ARCHITECTURE-DECISIONS.md) record constraints,
and code and tests establish current behavior. [Plans and research](README.md)
are proposals or dated evidence, not specifications of current behavior.

## Find the implementation and tests

App unit tests are co-located as `*.spec.ts`; the last column adds useful starting
points, not a complete test requirement. Read the [E2E guide](../e2e/AGENTS.md)
before editing or running E2E tests. Test commands live in [AGENTS.md](../AGENTS.md#core-commands)
and the [package validation table](../packages/README.md#validation).

For a focused single-provider sync E2E, use `npm run e2e:supersync:file <path>` or
`npm run e2e:webdav:file <path>` so the named server's absence fails the run.
Provider-switch scenarios need both servers and both required flags; follow the
[E2E guide](../e2e/AGENTS.md#run-the-right-suite). Skipped tests do not validate the change.

| Task / search terms                                       | Code entry points                                                                                                                                                                                                                                                                       | Focused tests / deeper map                                                                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tasks, subtasks, completion, task list, drag and drop     | [TaskService](../src/app/features/tasks/task.service.ts), [task UI](../src/app/features/tasks/task/), [task store](../src/app/features/tasks/store/)                                                                                                                                    | [TaskService specs](../src/app/features/tasks/task.service.spec.ts), [task E2E](../e2e/tests/task-basic/), [drag/drop E2E](../e2e/tests/task-dragdrop/)                            |
| Today, due dates, planner, timeline, scheduling           | [PlannerService](../src/app/features/planner/planner.service.ts), [ScheduleService](../src/app/features/schedule/schedule.service.ts), [work-context selectors](../src/app/features/work-context/store/), [DateService](../src/app/core/date/date.service.ts)                           | [Planner specs](../src/app/features/planner/planner.service.spec.ts), [schedule E2E](../e2e/tests/schedule/)                                                                       |
| Repeating tasks, recurrence, reminders, calendar events   | [repeat configuration](../src/app/features/task-repeat-cfg/task-repeat-cfg.service.ts), [reminders](../src/app/features/reminder/reminder.service.ts), [calendar integration](../src/app/features/calendar-integration/)                                                                | [Recurring E2E](../e2e/tests/recurring/), [reminder E2E](../e2e/tests/reminders/), [calendar E2E](../e2e/tests/calendar/)                                                          |
| Timer, tracked time, worklog, Pomodoro, focus, breaks     | [TimeTrackingService](../src/app/features/time-tracking/time-tracking.service.ts), [worklog](../src/app/features/worklog/), [focus mode](../src/app/features/focus-mode/), [breaks](../src/app/features/take-a-break/)                                                                  | [Time tracking specs](../src/app/features/time-tracking/time-tracking.service.spec.ts), [focus E2E](../e2e/tests/focus-mode/), [worklog E2E](../e2e/tests/worklog/)                |
| Projects, tags, boards, sections, active list             | [projects](../src/app/features/project/), [tags](../src/app/features/tag/), [boards](../src/app/features/boards/), [sections](../src/app/features/section/), [work context](../src/app/features/work-context/)                                                                          | [Project E2E](../e2e/tests/project/), [tag E2E](../e2e/tests/tags/), [board E2E](../e2e/tests/boards/)                                                                             |
| NgRx, actions, reducers, effects, cross-entity state      | [root store](../src/app/root-store/), [meta-reducer registry](../src/app/root-store/meta/meta-reducer-registry.ts), [shared task meta-reducers](../src/app/root-store/meta/task-shared-meta-reducers/)                                                                                  | Co-located reducer specs; [app layer map](../src/app/README.md)                                                                                                                    |
| Sync, remote replay, conflicts, WebDAV, Dropbox, OneDrive | [capture](../src/app/op-log/capture/), [apply](../src/app/op-log/apply/), [sync orchestration](../src/app/op-log/sync/), [shared sync logic](../packages/sync-core/), [provider implementations](../packages/sync-providers/), [app provider wiring](../src/app/op-log/sync-providers/) | [Sync map](sync-and-op-log/README.md), [scenario-to-test index](sync-and-op-log/supersync-scenarios.md)                                                                            |
| Storage, IndexedDB, SQLite, hydration, startup recovery   | [persistence](../src/app/op-log/persistence/), [data initialization](../src/app/core/data-init/), [validation](../src/app/op-log/validation/)                                                                                                                                           | [Store specs](../src/app/op-log/persistence/operation-log-store.service.spec.ts), [frozen-state specs](../src/app/op-log/validation/frozen-state.spec.ts)                          |
| Import, export, backup, restore, sync setup UI            | [file import/export](../src/app/imex/file-imex/), [local backup](../src/app/imex/local-backup/), [sync UI](../src/app/imex/sync/)                                                                                                                                                       | [Import/export E2E](../e2e/tests/import-export/), [recovery contract](sync-and-op-log/local-recovery-points.md)                                                                    |
| SuperSync server, accounts, database, hosting             | [server source](../packages/super-sync-server/src/), [Prisma](../packages/super-sync-server/prisma/)                                                                                                                                                                                    | [Server tests](../packages/super-sync-server/tests/), [server README](../packages/super-sync-server/README.md), [architecture](../packages/super-sync-server/docs/architecture.md) |
| GitHub, GitLab, Jira, issue integrations, two-way sync    | [IssueService](../src/app/features/issue/issue.service.ts), [providers](../src/app/features/issue/providers/), [two-way sync](../src/app/features/issue/two-way-sync/)                                                                                                                  | [Issue specs](../src/app/features/issue/issue.service.spec.ts), [integration guide](add-new-integration.md)                                                                        |
| Plugins, extensions, plugin API, sandbox                  | [plugin runtime](../src/app/plugins/), [public API](../packages/plugin-api/), [examples](../packages/plugin-dev/)                                                                                                                                                                       | [Plugin E2E](../e2e/tests/plugins/), [plugin development](plugin-development.md)                                                                                                   |
| Settings, preferences, shortcuts, translations            | [configuration](../src/app/features/config/), [shortcut handling](../src/app/core-ui/shortcut/shortcut.service.ts), [language service](../src/app/core/language/), [English strings](../src/assets/i18n/en.json)                                                                        | [Settings E2E](../e2e/tests/settings/), [keyboard E2E](../e2e/tests/keyboard/), [translation guide](TRANSLATING.md)                                                                |
| Styling, theme, reusable widgets, navigation, screens     | [shared UI](../src/app/ui/), [theme](../src/app/core/theme/), [app shell](../src/app/core-ui/), [routes](../src/app/routes/), [pages](../src/app/pages/)                                                                                                                                | [App layer map](../src/app/README.md), [navigation E2E](../e2e/tests/navigation/)                                                                                                  |
| Electron, desktop, tray, windows, IPC                     | [main entry](../electron/main.ts), [tray indicator](../electron/indicator.ts), [IPC handlers](../electron/ipc-handler.ts), [frontend bridge](../src/app/core/electron/)                                                                                                                 | Co-located `*.test.cjs` in [electron](../electron/); [packaged smoke test](../e2e/electron/packaged-app-smoke.cjs)                                                                 |
| Android, iOS, mobile, native shell                        | [Android](../android/), [iOS](../ios/), [Android frontend](../src/app/features/android/), [iOS frontend](../src/app/features/ios/)                                                                                                                                                      | [Android README](../android/README.md), [mobile E2E](../e2e/tests/mobile/), [platform E2E](../e2e/tests/platform/)                                                                 |
| Build, CI, packaging, release, deployment                 | [root scripts](../package.json), [workflows](../.github/workflows/), [build tools](../tools/), [Electron packaging](../electron-builder.yaml)                                                                                                                                           | [Release runbook](release-and-publishing.md), [Apple releases](apple-release-automation.md)                                                                                        |

## Read the constraints that match the change

- **User-visible behavior:** [documentation guide](documentation-guide.md).
  **Styles and shared components:** [styling guide](styling-guide.md) and
  [theme contract](theming-contract.md).
- **Synced state, effects, reducers, replay:** [contributor sync model](sync-and-op-log/contributor-sync-model.md).
  **Package boundaries:** [sync ownership](sync-and-op-log/package-boundaries.md).
- **Persisted fields or wire formats:** [persisted model fields](sync-and-op-log/persisted-model-fields.md),
  [shared schema](../packages/shared-schema/), and the
  [schema-bump policy](sync-and-op-log/operation-log-architecture.md#bump-policy--a-bump-does-not-protect-the-released-fleet). **Public/plugin API changes:**
  [long-term cost review](feature-review-guide.md).
- **Today membership or day boundaries:** [due-date exclusivity](../ARCHITECTURE-DECISIONS.md#1-duedayduewithtime-mutual-exclusivity-pattern),
  [virtual Today membership](../ARCHITECTURE-DECISIONS.md#2-today_tag-virtual-tag-pattern),
  and the logical-clock/Today rules in [AGENTS.md](../AGENTS.md#sync-correctness-rules).
- **Reported sync/data-loss bugs:** [severity and release verification](sync-and-op-log/sync-severity-triage.md)
  plus the reproduction requirements in [AGENTS.md](../AGENTS.md#sync-correctness-rules).

## Navigation traps and maintenance

- Current persistence lives in [op-log/persistence](../src/app/op-log/persistence/).
  [pfapi](../src/app/pfapi/) is legacy compiled code; the live
  [legacy database reader](../src/app/core/persistence/legacy-pf-db.service.ts)
  is a separate migration component.
- Issue-provider synchronization and application-state synchronization have
  different entry points; use their separate rows above.
- If no row fits, use the [app layer map](../src/app/README.md) and search filenames
  with `rg --files` before widening a content search. Missing from this map does
  not mean missing from the repository.
- Keep this map curated and short. Update affected links when moving entry
  points; put detailed explanations in the linked subsystem guide. Use Markdown
  links for paths so `npm run docs:check-links` validates them. Link validation
  catches missing paths, not stale descriptions; verify meaning against code.
