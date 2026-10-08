export interface FileAdapter {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, dataStr: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  checkDirExists?(dirPath: string): Promise<boolean>;
}
