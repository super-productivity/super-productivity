# Super Productivity - Gemini Context

## Project Overview

Super Productivity is an advanced todo list and time tracking application built with **Angular**, **Electron**, and **Capacitor**. It targets Web, Desktop (Linux, macOS, Windows), and Mobile (Android).

## Architecture & Tech Stack

- **Frontend:** Angular (Standalone components, Material Design)
- **State Management:** NgRx (Redux pattern). Critical: Uses `LOCAL_ACTIONS` injection token for Effects to prevent re-triggering during sync replay.
- **Desktop Wrapper:** Electron (Main process in `electron/`).
- **Mobile Wrapper:** Capacitor (Native Android project in `android/`).
- **Persistence:** IndexedDB (via `idb`), managed in `src/app/op-log/persistence/`.
- **Sync:** Custom conflict-aware sync (Dropbox, WebDAV, Local File) using vector clocks.

## Key Directories

- `src/`: Main Angular application source.
  - `app/features/`: Feature-specific modules (tasks, projects, etc.).
  - `app/core/`: Core services and state.
  - `app/imex/`: Import/Export and Sync logic.
- `electron/`: Electron main process source code (`main.ts`, IPC handlers).
- `android/`: Native Android project files.
- `e2e/`: Playwright end-to-end tests.
- `tools/`: Build, maintenance, and utility scripts.

## Development Workflow

### Setup

```bash
npm install
```

### Running the App

- **Desktop (Electron + Angular):**
  ```bash
  npm start
  ```
- **Web (Angular only):**
  ```bash
  ng serve
  # OR
  npm run startFrontend
  ```

### Testing

- **Unit Tests (Jasmine/Karma):**
  ```bash
  npm test
  # Run for specific file
  npm run test:file <filepath>
  ```
- **E2E Tests (Playwright):**
  ```bash
  npm run e2e
  # Run specific test file
  npm run e2e:file <filepath>
  ```

### Code Quality & Formatting

- **Lint & Format (Single File - RECOMMENDED):**
  ```bash
  npm run checkFile <filepath>
  ```
- **Lint All:**
  ```bash
  npm run lint
  ```
- **Format All:**
  ```bash
  npm run prettier
  ```

## Critical Development Rules

1.  **NgRx Effects:** Always use `inject(LOCAL_ACTIONS)` instead of `Actions` in Effects to ensure they only run for local user actions, not during sync replay.
2.  **State Mutation:** Never mutate state directly. Use reducers.
3.  **Type Safety:** Strict TypeScript is enforced. Avoid `any`.
4.  **Translations:** Only edit `src/assets/i18n/en.json`. Do not edit other language files manually.
5.  **Commit Messages:** Follow Angular convention: `type(scope): description`.
    - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
6.  **Electron:** Check `IS_ELECTRON` before using desktop-specific features in frontend code.

## Build for Production

```bash
# Build for all platforms (detected in env)
npm run dist

# Build Web Prod
npm run buildFrontend:prod:es6
```
