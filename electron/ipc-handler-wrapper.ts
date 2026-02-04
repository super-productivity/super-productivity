import { app } from 'electron';
import * as path from 'path';

/**
 * Validates if the given path is within the userData directory.
 */
export const validatePathInUserData = (basePath: string): boolean => {
  const userDataPath = app.getPath('userData');
  const resolvedBasePath = path.resolve(basePath);
  const resolvedUserDataPath = path.resolve(userDataPath);
  return resolvedBasePath.startsWith(resolvedUserDataPath);
};

/**
 * Creates a validated IPC handler with consistent error handling and optional path validation.
 */
export const createValidatedHandler = <TArgs extends object, TResult>(
  handler: (args: TArgs) => Promise<TResult>,
  options?: {
    validatePath?: boolean;
    errorValue?: TResult;
  },
): ((event: Electron.IpcMainInvokeEvent, args: TArgs) => Promise<TResult>) => {
  return async (_, args: TArgs) => {
    try {
      // Add path validation if requested
      if (options?.validatePath && 'basePath' in args) {
        const basePath = (args as any).basePath;
        if (!validatePathInUserData(basePath)) {
          throw new Error('Invalid base path');
        }
      }

      return await handler(args);
    } catch (error) {
      console.error(`IPC handler error:`, error);
      if (options?.errorValue !== undefined) {
        return options.errorValue;
      }
      throw error;
    }
  };
};
