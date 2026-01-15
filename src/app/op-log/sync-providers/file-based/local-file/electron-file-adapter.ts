import { FileAdapter } from './file-adapter.interface';
import { ElectronAPI } from '../../../../../../electron/electronAPI';

export class ElectronFileAdapter implements FileAdapter {
  private readonly ea: ElectronAPI;

  constructor() {
    this.ea = (window as any).ea as ElectronAPI;
  }

  async readFile(filePath: string): Promise<string> {
    const result = await this.ea.fileSyncLoad({
      filePath,
      localRev: null,
    });
    if (result instanceof Error) {
      throw result;
    }

    return result.dataStr as string;
  }

  async writeFile(filePath: string, dataStr: string): Promise<void> {
    const result = await this.ea.fileSyncSave({
      localRev: null,
      filePath,
      dataStr,
    });
    if (result instanceof Error) {
      throw result;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const result = await this.ea.fileSyncRemove({
      filePath,
    });
    if (result instanceof Error) {
      throw result;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    const result = await this.ea.fileSyncListFiles({
      dirPath,
    });
    if (result instanceof Error) {
      throw result;
    }
    return result;
  }

  // async checkDirExists(dirPath: string): Promise<boolean> {
  //   try {
  //     const result = await this.ea.checkDirExists({
  //       dirPath,
  //     });
  //     if (result instanceof Error) {
  //       throw result;
  //     }
  //     return result;
  //   } catch (e) {
  //     PFLog.critical( `ElectronFileAdapter.checkDirExists() error`, e);
  //     return false;
  //   }
  // }
  //
  // async pickDirectory(): Promise<string | void> {
  //   try {
  //     return await this.ea.pickDirectory();
  //   } catch (e) {
  //     PFLog.critical( `ElectronFileAdapter.pickDirectory() error`, e);
  //     throw e;
  //   }
  // }
}
