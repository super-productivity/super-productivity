/* eslint-disable */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { PFLog } from '../../../../../core/log';

// Define the plugin interface for SAF operations
export interface SafPlugin {
  selectFolder(): Promise<{ uri: string }>;

  readFile(options: { uri: string; fileName: string }): Promise<{ data: string }>;

  writeFile(options: {
    uri: string;
    fileName: string;
    data: string;
  }): Promise<{ success: boolean }>;

  deleteFile(options: { uri: string; fileName: string }): Promise<{ success: boolean }>;

  checkFileExists(options: {
    uri: string;
    fileName: string;
  }): Promise<{ exists: boolean }>;

  checkUriPermission(options: { uri: string }): Promise<{ hasPermission: boolean }>;
}

// Register the plugin
const SafBridge = registerPlugin<SafPlugin>('SafBridge', {
  web: {
    async selectFolder() {
      throw new Error('SAF is not supported on web platform');
    },
    async readFile() {
      throw new Error('SAF is not supported on web platform');
    },
    async writeFile() {
      throw new Error('SAF is not supported on web platform');
    },
    async deleteFile() {
      throw new Error('SAF is not supported on web platform');
    },
    async checkFileExists() {
      throw new Error('SAF is not supported on web platform');
    },
    async checkUriPermission() {
      throw new Error('SAF is not supported on web platform');
    },
  },
});

export class SafService {
  static async isAndroid(): Promise<boolean> {
    return Capacitor.getPlatform() === 'android';
  }

  static async selectFolder(): Promise<string> {
    if (!(await this.isAndroid())) {
      throw new Error('SAF is only supported on Android');
    }

    const result = await SafBridge.selectFolder();
    return result.uri;
  }

  static async checkPermission(uri?: string): Promise<boolean> {
    if (!uri) {
      return false;
    }

    try {
      const result = await SafBridge.checkUriPermission({ uri });
      return result.hasPermission;
    } catch (error) {
      PFLog.err('Error checking SAF permission:', error);
      return false;
    }
  }

  static async readFile(uri: string, fileName: string): Promise<string> {
    if (!uri) {
      throw new Error('No SAF folder URI provided');
    }

    const result = await SafBridge.readFile({ uri, fileName });
    return result.data;
  }

  static async writeFile(uri: string, fileName: string, data: string): Promise<void> {
    if (!uri) {
      throw new Error('No SAF folder URI provided');
    }

    await SafBridge.writeFile({ uri, fileName, data });
  }

  static async deleteFile(uri: string, fileName: string): Promise<void> {
    if (!uri) {
      throw new Error('No SAF folder URI provided');
    }

    await SafBridge.deleteFile({ uri, fileName });
  }

  static async checkFileExists(uri: string, fileName: string): Promise<boolean> {
    if (!uri) {
      return false;
    }

    try {
      const result = await SafBridge.checkFileExists({ uri, fileName });
      return result.exists;
    } catch (error) {
      PFLog.err('Error checking file existence:', error);
      return false;
    }
  }
}
