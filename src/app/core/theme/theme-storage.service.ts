import { Injectable, signal, Signal } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Log } from '../log';
import { MAX_THEME_CSS_SIZE, validateThemeCss } from './validate-theme-css.util';
import { ThemeCssWarning } from './theme-contract.const';

/**
 * A user-installed CSS theme.
 *
 * `id` is the slugified filename — e.g. `Dracula.css` becomes `dracula`.
 * Re-uploading a file with the same slug overwrites the existing theme.
 *
 * `name` is the prettified id (title-cased). Authors who want a fancy
 * display name can rename the file before installing.
 *
 * `warnings` is a snapshot of the validator's contract-presence findings at
 * install time — preserved across the IDB round-trip so the picker can
 * surface them without re-running validation.
 */
export interface StoredTheme {
  id: string;
  name: string;
  css: string;
  uploadDate: number;
  warnings?: ThemeCssWarning[];
}

const DB_NAME = 'SUPThemes';
const DB_STORE_NAME = 'themes';
const DB_VERSION = 1;

interface ThemesDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: StoredTheme;
  };
}

const slugify = (filename: string): string => {
  // Strip extension, lowercase, replace runs of non-alphanumerics with `-`,
  // trim leading/trailing `-`. Empty results are coerced to `theme`.
  const base = filename.replace(/\.[^.]+$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'theme';
};

const prettifyId = (id: string): string =>
  id
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');

@Injectable({ providedIn: 'root' })
export class ThemeStorageService {
  private _db: IDBPDatabase<ThemesDb> | undefined;
  private _initPromise: Promise<IDBPDatabase<ThemesDb>> | undefined;
  private _themes = signal<StoredTheme[]>([]);
  private _hasLoaded = false;

  /** Reactive list of installed user themes. */
  readonly themes: Signal<StoredTheme[]> = this._themes.asReadonly();

  /**
   * Read the file, validate the CSS, persist it to IDB, then update the
   * signal. Resolution is awaited by callers before they write the active-
   * theme key — a tab close between IDB put and LS write would otherwise
   * leave LS pointing at a non-existent theme.
   */
  async installFromFile(file: File): Promise<StoredTheme> {
    // Reject oversize files before reading any bytes. The validator's own
    // size check still runs against the decoded byte length (which can
    // differ from `file.size` for multi-byte encodings).
    if (file.size > MAX_THEME_CSS_SIZE) {
      throw new Error(
        `File too large: ${(file.size / 1024).toFixed(1)} KB (max ${(
          MAX_THEME_CSS_SIZE / 1024
        ).toFixed(0)} KB)`,
      );
    }
    const css = await file.text();
    const validation = validateThemeCss(css);
    const id = slugify(file.name);
    if (!validation.isValid) {
      const reason = validation.errors.join('; ');
      // Log structured: filename can be PII (project names etc.) and the
      // validator's error strings can echo user-controlled CSS bytes — Log
      // history is exportable so we record only the slug + error count.
      Log.err({ themeId: id, errorCount: validation.errors.length });
      throw new Error(reason);
    }
    const theme: StoredTheme = {
      id,
      name: prettifyId(id),
      css,
      uploadDate: Date.now(),
      ...(validation.warnings && validation.warnings.length > 0
        ? { warnings: validation.warnings }
        : {}),
    };

    const db = await this._ensureDb();
    await db.put(DB_STORE_NAME, theme);
    await this._refreshThemes();
    return theme;
  }

  /**
   * Delete a stored theme from IDB and refresh the signal. Storage layer
   * owns nothing beyond IDB — orchestrating active-theme handoff is
   * `CustomThemeService.removeUserTheme()`'s job.
   */
  async removeTheme(id: string): Promise<void> {
    const db = await this._ensureDb();
    await db.delete(DB_STORE_NAME, id);
    await this._refreshThemes();
  }

  async getTheme(id: string): Promise<StoredTheme | undefined> {
    const db = await this._ensureDb();
    return db.get(DB_STORE_NAME, id);
  }

  async listThemes(): Promise<StoredTheme[]> {
    const db = await this._ensureDb();
    const all = await db.getAll(DB_STORE_NAME);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async _ensureDb(): Promise<IDBPDatabase<ThemesDb>> {
    if (this._db) {
      return this._db;
    }
    if (!this._initPromise) {
      this._initPromise = openDB<ThemesDb>(DB_NAME, DB_VERSION, {
        upgrade: (database) => {
          if (!database.objectStoreNames.contains(DB_STORE_NAME)) {
            database.createObjectStore(DB_STORE_NAME, { keyPath: 'id' });
          }
        },
      }).then((opened) => {
        this._db = opened;
        return opened;
      });
    }
    const db = await this._initPromise;
    if (!this._hasLoaded) {
      this._hasLoaded = true;
      await this._refreshThemes();
    }
    return db;
  }

  private async _refreshThemes(): Promise<void> {
    const all = await this.listThemes();
    this._themes.set(all);
  }
}
