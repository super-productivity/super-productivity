import { Injectable, signal, Signal } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';

export interface StoredCustomSound {
  id: string;
  name: string;
  arrayBuffer: ArrayBuffer;
  uploadDate: number;
}

const DB_NAME = 'SUPCustomSounds';
const DB_STORE_NAME = 'sounds';
const DB_VERSION = 1;
const MAX_SOUND_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

interface CustomSoundsDb extends DBSchema {
  [DB_STORE_NAME]: {
    key: string;
    value: StoredCustomSound;
  };
}

const slugify = (filename: string): string => {
  const base = filename.replace(/\.[^.]+$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'sound';
};

/**
 * Persistent storage for user-uploaded custom sounds.
 *
 * Sounds are stored as ArrayBuffers in an IndexedDB database (`SUPCustomSounds`).
 * The `sounds` signal provides a reactive, sorted list of all installed sounds.
 *
 * Follows the same pattern as ThemeStorageService.
 */
@Injectable({ providedIn: 'root' })
export class CustomSoundStorageService {
  private _db: IDBPDatabase<CustomSoundsDb> | undefined;
  private _initPromise: Promise<IDBPDatabase<CustomSoundsDb>> | undefined;
  private _hasLoaded = false;
  private _sounds = signal<StoredCustomSound[]>([]);

  /** Reactive sorted list of installed custom sounds. */
  readonly sounds: Signal<StoredCustomSound[]> = this._sounds.asReadonly();

  /**
   * Reads an audio file, validates it, and persists it to IDB.
   * Re-uploading a file with the same slugified name overwrites the existing entry.
   */
  async installFromFile(file: File): Promise<StoredCustomSound> {
    if (file.size > MAX_SOUND_SIZE_BYTES) {
      throw new Error(
        `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB (max 5 MB)`,
      );
    }
    if (file.type && !file.type.startsWith('audio/')) {
      throw new Error('Unsupported format. Use MP3, WAV, or OGG.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const id = slugify(file.name);
    const sound: StoredCustomSound = {
      id,
      name: id,
      arrayBuffer,
      uploadDate: Date.now(),
    };
    const db = await this._ensureDb();
    await db.put(DB_STORE_NAME, sound);
    await this._refresh();
    return sound;
  }

  /** Removes a stored custom sound by id and refreshes the signal. */
  async removeSound(id: string): Promise<void> {
    const db = await this._ensureDb();
    await db.delete(DB_STORE_NAME, id);
    await this._refresh();
  }

  /** Returns a single stored custom sound, or undefined if not found. */
  async getSound(id: string): Promise<StoredCustomSound | undefined> {
    const db = await this._ensureDb();
    return db.get(DB_STORE_NAME, id);
  }

  /** Returns all stored sounds, sorted by name. */
  async listSounds(): Promise<StoredCustomSound[]> {
    const db = await this._ensureDb();
    const all = await db.getAll(DB_STORE_NAME);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async _ensureDb(): Promise<IDBPDatabase<CustomSoundsDb>> {
    if (this._db) {
      return this._db;
    }
    if (!this._initPromise) {
      this._initPromise = openDB<CustomSoundsDb>(DB_NAME, DB_VERSION, {
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
      await this._refresh();
    }
    return db;
  }

  private async _refresh(): Promise<void> {
    const all = await this.listSounds();
    this._sounds.set(all);
  }
}
