import { FileAdapter } from '../file-adapter.interface';
import { SafService } from './saf.service';
import { SyncLog } from '../../../../../core/log';

export class SafFileAdapter implements FileAdapter {
  constructor(private getUri: () => Promise<string | undefined>) {}

  async readFile(filePath: string): Promise<string> {
    try {
      const uri = await this.getUri();
      if (!uri) {
        throw new Error('No SAF folder URI available');
      }
      return await SafService.readFile(uri, filePath);
    } catch (error) {
      if (error?.toString?.().includes('File not found')) {
        throw new Error(`File not found: ${filePath}`);
      }
      throw error;
    }
  }

  async writeFile(filePath: string, dataStr: string): Promise<void> {
    const uri = await this.getUri();
    if (!uri) {
      throw new Error('No SAF folder URI available');
    }
    await SafService.writeFile(uri, filePath, dataStr);
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      const uri = await this.getUri();
      if (!uri) {
        throw new Error('No SAF folder URI available');
      }
      await SafService.deleteFile(uri, filePath);
    } catch (error) {
      // Ignore file not found errors
      if (error?.toString?.().includes('File not found')) {
        SyncLog.err(`File not found for deletion: ${filePath}`);
        return;
      }
      throw error;
    }
  }

  async checkDirExists?(dirPath: string): Promise<boolean> {
    const uri = await this.getUri();
    // SAF works with a selected folder, so we just check if we have permission
    return await SafService.checkPermission(uri);
  }

  // TODO: implement for operation log sync
  async listFiles?(dirPath: string): Promise<string[]> {
    SyncLog.warn('SafFileAdapter: listFiles is not yet implemented for Android SAF.');
    throw new Error('SafFileAdapter: listFiles is not yet implemented.');
  }
}
