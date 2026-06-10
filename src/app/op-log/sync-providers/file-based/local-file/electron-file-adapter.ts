import type { FileAdapter } from '@sp/sync-providers/file-based';
import { ElectronAPI } from '../../../../../../electron/electronAPI';

/**
 * Bridges `FileAdapter` calls to the Electron main process.
 *
 * Post-issue-#8228: the adapter sends only a *relative* path. The sync
 * folder is owned main-side (inlined at the top of
 * `electron/local-file-sync.ts`); the renderer never round-trips an
 * absolute path. The base class's `getFilePath` already returns the
 * relative form for Electron — we just forward it here.
 */
export class ElectronFileAdapter implements FileAdapter {
  private readonly ea: ElectronAPI;

  constructor() {
    this.ea = (window as any).ea as ElectronAPI;
  }

  async readFile(relativePath: string): Promise<string> {
    const result = await this.ea.fileSyncLoad({
      relativePath,
      localRev: null,
    });
    if (result instanceof Error) {
      throw result;
    }

    return result.dataStr as string;
  }

  async writeFile(relativePath: string, dataStr: string): Promise<void> {
    const result = await this.ea.fileSyncSave({
      localRev: null,
      relativePath,
      dataStr,
    });
    if (result instanceof Error) {
      throw result;
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const result = await this.ea.fileSyncRemove({
      relativePath,
    });
    if (result instanceof Error) {
      throw result;
    }
  }

  async listFiles(relativePath: string): Promise<string[]> {
    const result = await this.ea.fileSyncListFiles({
      relativePath,
    });
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }
}
