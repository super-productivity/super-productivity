import { app } from 'electron';
import { isPathInsideDir } from './file-path-guard';
import { SUPPORTED_IMAGE_EXTENSIONS } from './shared-with-frontend/mime-type-mapping.const';

/**
 * Validates that `basePath` is within the userData directory. Uses proper
 * containment (not a bare startsWith, which would accept a sibling like
 * `<userData>-evil`).
 */
export const validatePathInUserData = (basePath: string): boolean =>
  typeof basePath === 'string' && isPathInsideDir(app.getPath('userData'), basePath);

// A safe filename/id: a single path segment — no separators, no `..`, no NUL.
const isSafeName = (name: unknown): name is string =>
  typeof name === 'string' &&
  name.length > 0 &&
  !name.includes('/') &&
  !name.includes('\\') &&
  !name.includes('..') &&
  !name.includes('\0');

const isSafeImageFileName = (name: unknown): name is string =>
  isSafeName(name) &&
  SUPPORTED_IMAGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/**
 * Creates a validated IPC handler with consistent error handling and optional
 * path validation.
 *
 * SECURITY: the renderer is untrusted (a plugin or XSS payload can call any
 * window.ea IPC). With `validatePath`, the handler refuses any `basePath`
 * outside userData, any `fileName` that is not a plain image basename, and any
 * `imageId` containing path separators/`..`. Without this a renderer could
 * write e.g. `<userData>/simpleSettings` (forging the nodeExecution grant file)
 * or traverse out of the images dir.
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
      if (options?.validatePath && args && 'basePath' in args) {
        const a = args as Record<string, unknown>;
        if (!validatePathInUserData(a.basePath as string)) {
          throw new Error('Invalid base path');
        }
        if ('fileName' in a && !isSafeImageFileName(a.fileName)) {
          throw new Error('Invalid file name');
        }
        if ('imageId' in a && !isSafeName(a.imageId)) {
          throw new Error('Invalid image id');
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
