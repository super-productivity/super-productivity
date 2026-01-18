# Agent Guide (AGENTS.md)

This file provides detailed instructions, context, and coding standards for AI agents (Claude, Cursor, Copilot, etc.) working on the Super Productivity codebase.

**IMPORTANT:** Also read `CLAUDE.md` for specific architectural constraints and testing patterns.

## 1. General Guidelines & Philosophy

1.  **Functional over OOP**: Prefer pure functions and immutability. Avoid class-based state where possible outside of NgRx/Services.
2.  **KISS (Keep It Simple, Stupid)**: Avoid over-engineering. If a simple function suffices, don't build a service.
3.  **DRY (Don't Repeat Yourself)**: Extract common logic to `src/app/util` or shared services.
4.  **Safety First**: Always verify changes. If unsure about a side effect (especially with Sync or Persistence), ask the user.
5.  **Strict Typing**: The codebase uses strict TypeScript. Never use `any`. Use `unknown` if necessary and cast safely with guards.

### 🧠 ADHD-Friendly & Stability Guidelines (CRITICAL)

- **Stability Over Novelty:** Do not enable experimental features (like **Domina Mode**) without explicit safety checks and user confirmation. These features have caused crashes in the past.
- **Workflow Simplification:** Prioritize workflows that reduce visual noise, click fatigue, and decision paralysis.
  - _Example:_ Prefer "Now/Later" over complex priority matrices.
  - _Example:_ Automate organization (e.g., auto-moving tasks to projects) where possible.
- **Scope Containment:** When refactoring or adding features, ensure they strictly align with the user's explicit goals. Do not add "nice to have" features that complicate the UI unless requested. **Prevent Scope Creep.**

## 2. Essential Development Commands

### ⚡ Verification (CRITICAL)

Run these commands to verify your changes before finishing a task.

- **Check Single File (Lint + Format)**:
  `npm run checkFile <path/to/file.ts>`
  - _Usage:_ Run this on EVERY modified file.
  - _Example:_ `npm run checkFile src/app/features/tasks/task.service.ts`

- **Test Single File (Unit)**:
  `npm run test:file <path/to/spec.ts>`
  - _Usage:_ Verify logic changes in isolation.
  - _Example:_ `npm run test:file src/app/features/tasks/task.service.spec.ts`

### Build & Run

- **Web Dev Server**: `npm run startFrontend` (Access at http://localhost:4200)
- **Electron Dev**: `npm start`
- **Full Build**: `npm run dist`

### Project-wide Checks

- **Lint All**: `npm run lint`
- **Test All**: `npm test` (Headless Chrome)
- **E2E Tests**: `npm run e2e` (Playwright)

## 3. Code Style & Conventions

### Formatting (Prettier)

- **Indentation**: 2 spaces
- **Quotes**: Single quotes `'`
- **Max Line Length**: 90 characters
- **Trailing Commas**: All
- _Note:_ `npm run checkFile` automatically fixes formatting.

### TypeScript & Angular

- **Signals vs Observables**:
  - Use **Signals** for component state, derived view data, and synchronous reactivity.
  - Use **Observables** for complex event streams, async side effects (API calls), and NgRx Effects.
- **Change Detection**: Always use `ChangeDetectionStrategy.OnPush` in components.
- **DI**: Use constructor injection with `private readonly`.
- **Control Flow**: Use modern Angular control flow (`@if`, `@for`) over `*ngIf`/`*ngFor` if available in the version.

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `task-item.component.ts`)
- **Classes**: `PascalCase` (e.g., `TaskItemComponent`)
- **Services**: `PascalCase` ending in `Service` (e.g., `TaskService`)
- **Variables/Functions**: `camelCase`
- **Observables**: End with `$` (e.g., `tasks$`, `isLoading$`)
- **Signals**: No specific suffix required, but context should be clear.

### Error Handling

- **User Notification**: Use `SnackService` or global config to notify users of errors.
- **Silent Failures**: Avoid empty `catch` blocks. Log to console or error handler.
- **Async**: Always handle errors in Observables (catchError) or Promises (try/catch).

## 4. Architecture Overview

### State Management (NgRx)

- **Store**: Single source of truth.
- **Actions**: Describe unique events (e.g., `[Task Page] Load Tasks`).
- **Reducers**: Pure functions updating state. **NEVER** mutate state.
- **Selectors**: Select slices of state. Use `createSelector` for memoization.
- **Effects**: Handle side effects (persistence, sync, network).

### Directory Structure

- `src/app/features/`: Feature modules (Tasks, Projects, Tags, Config). Each has its own state/services.
- `src/app/core/`: Singleton core services (Persistence, ErrorHandling, Theme).
- `src/app/ui/`: Reusable "dumb" UI components.
- `src/app/imex/`: Import/Export and Sync logic.
- `src/app/util/`: Pure utility functions (Dates, ID generation, Validation).
- `electron/`: Electron main process code.

### Data Persistence & Sync

- **Storage**: Data is stored locally in IndexedDB.
- **Sync**: `src/app/imex/sync/` handles synchronization with providers (Dropbox, WebDAV, etc.).
- **Conflict Resolution**: Uses vector clocks. Be extremely careful modifying sync logic.

### Cross-Platform

- **Electron**: Checks `IS_ELECTRON` before using native APIs (IPC, Tray).
- **Mobile**: Uses Capacitor.
- **Web**: PWA capabilities.

## 5. Testing Guidelines

- **Unit Tests (`.spec.ts`)**:
  - Co-located with the source file.
  - Test services and pure functions extensively.
  - Mock dependencies using `provideMockStore` or jasmine spies.
- **E2E Tests**:
  - Located in `e2e/`.
  - Use Playwright.
  - Focus on critical user flows (Creating tasks, Syncing, Config).

## 6. 🚫 Anti-Patterns (Avoid These)

1.  **Direct DOM Access**: Do not use `document.getElementById`. Use Angular `ElementRef` or `Renderer2`.
2.  **Logic in Templates**: Do not call complex functions in HTML templates. Compute values in the component (Signals/Getters).
3.  **Subscription Leaks**: Always unsubscribe. Use `takeUntilDestroyed`, `async` pipe, or `first()`.
4.  **Implicit Any**: Do not disable `noImplicitAny`.
5.  **Heavy CSS**: Avoid deep nesting. Use utility classes or Angular Material mixins.
6.  **Constructor Logic**: Keep constructors empty mostly. Use `ngOnInit` for initialization.

## 7. Important Development Notes

- **Translations**: UI strings must use `TranslateService` (`T` helper).
- **Typia**: Used for runtime validation.
- **Code Reviews**: Self-review your code using the "Check Single File" command before presenting it.

## 8. Environment Context (CachyOS/Arch)

- **Platform**: CachyOS (Arch Linux based).
- **Installation Methods**:
  - **Repo (AUR/Pacman)**: Available via `yay` or `pacman`. Installs to `/usr/bin`.
  - **AppImage**: Portable format often used as an alternative.
  - **Source**: This repository is the source code.
- **Data Paths**:
  - **Standard Path**: `~/.config/superProductivity` (Standard Linux XDG config).
  - **Migration Note**: When switching between AppImage, Repo, or Source builds, always check `~/.config/superProductivity` to ensure data persists or to back it up.
- **Tools Available**: `pacman`, `yay` are available for system dependency management.
- **Performance**:
  - When running builds (`npm run dist` or `npm run build`), consider using multithreading where possible (e.g. `npm run dist -- --c.parallel=true` if supported by tool, or just `make -j$(nproc)` for native compilations).
  - Since this is an Arch-based system, assume modern hardware availability.

## 9. Git & GitHub Protocol

- **Safety Check**: Always check which branch you are on (`git status`) and where your remotes point (`git remote -v`) before pushing or pulling.
- **Forks vs Upstream**: This repository is a fork.
  - `origin`: Points to the user's fork (`git@github.com:mycochang/super-productivity.git`). Push your changes here.
  - `upstream`: Points to the official repository (`git@github.com:super-productivity/super-productivity.git`). Pull updates from here.

## 10. Process Management & Safety

- **Killing the App**: When killing the Super Productivity process (e.g. via `kill -9` or `pkill`), you MUST ensure ALL related processes are terminated, especially the GUI/Renderer processes.
  - **Command**: Use `pkill -9 -f superproductivity` to ensure a clean slate.
  - **Why**: Zombie renderer processes can hold file locks or keep the UI visible but frozen.

## 11. OpenCode & MCP Specifics

- **No `mcp remove` Command**: OpenCode does **NOT** support a `remove` command for MCP servers (e.g., `opencode mcp remove`).
  - **Workaround**: To restart or reconfigure an MCP server, you must kill the server process manually (e.g., `kill <pid>`) or modify the OpenCode configuration files directly if necessary. OpenCode will typically restart the server automatically or upon the next `add` attempt if the previous one is dead.
  - **Best Practice**: Treat MCP server configuration as persistent. If you need to change arguments, you may need to rely on the `add` command overwriting the existing entry or manual process management.
