import { SafFileAdapter } from './saf-file-adapter';
import { SafService } from './saf.service';
import { Log, LogLevel } from '../../../../../core/log';

describe('SafFileAdapter', () => {
  let adapter: SafFileAdapter;
  let mockGetUri: jasmine.Spy<() => Promise<string | undefined>>;
  const testUri = 'content://test.uri';

  beforeAll(() => {
    Log.setLevel(LogLevel.DEBUG);
  });

  beforeEach(() => {
    mockGetUri = jasmine.createSpy('getUri').and.returnValue(Promise.resolve(testUri));
    adapter = new SafFileAdapter(mockGetUri);
  });

  describe('readFile', () => {
    it('should read file using SafService', async () => {
      const mockData = 'test file content';
      spyOn(SafService, 'readFile').and.returnValue(Promise.resolve(mockData));

      const result = await adapter.readFile('test.json');

      expect(SafService.readFile).toHaveBeenCalledWith(testUri, 'test.json');
      expect(result).toBe(mockData);
    });

    it('should throw error when no URI is available', async () => {
      mockGetUri.and.returnValue(Promise.resolve(undefined));

      await expectAsync(adapter.readFile('test.json')).toBeRejectedWithError(
        'No SAF folder URI available',
      );
    });

    it('should throw file not found error with proper message', async () => {
      const fileName = 'missing.json';
      spyOn(SafService, 'readFile').and.returnValue(
        Promise.reject(new Error('File not found')),
      );

      await expectAsync(adapter.readFile(fileName)).toBeRejectedWithError(
        `File not found: ${fileName}`,
      );
    });

    it('should propagate other errors', async () => {
      const error = new Error('Permission denied');
      spyOn(SafService, 'readFile').and.returnValue(Promise.reject(error));

      await expectAsync(adapter.readFile('test.json')).toBeRejectedWith(error);
    });
  });

  describe('writeFile', () => {
    it('should write file using SafService', async () => {
      spyOn(SafService, 'writeFile').and.returnValue(Promise.resolve());

      await adapter.writeFile('test.json', '{"data": "test"}');

      expect(SafService.writeFile).toHaveBeenCalledWith(
        testUri,
        'test.json',
        '{"data": "test"}',
      );
    });

    it('should throw error when no URI is available', async () => {
      mockGetUri.and.returnValue(Promise.resolve(undefined));

      await expectAsync(
        adapter.writeFile('test.json', '{"data": "test"}'),
      ).toBeRejectedWithError('No SAF folder URI available');
    });

    it('should propagate write errors', async () => {
      const error = new Error('No space left');
      spyOn(SafService, 'writeFile').and.returnValue(Promise.reject(error));

      await expectAsync(
        adapter.writeFile('test.json', '{"data": "test"}'),
      ).toBeRejectedWith(error);
    });
  });

  describe('deleteFile', () => {
    it('should delete file using SafService', async () => {
      spyOn(SafService, 'deleteFile').and.returnValue(Promise.resolve());

      await adapter.deleteFile('test.json');

      expect(SafService.deleteFile).toHaveBeenCalledWith(testUri, 'test.json');
    });

    it('should throw error when no URI is available', async () => {
      mockGetUri.and.returnValue(Promise.resolve(undefined));

      await expectAsync(adapter.deleteFile('test.json')).toBeRejectedWithError(
        'No SAF folder URI available',
      );
    });

    it('should ignore file not found errors', async () => {
      spyOn(SafService, 'deleteFile').and.returnValue(
        Promise.reject(new Error('File not found')),
      );
      spyOn(console, 'error');

      await adapter.deleteFile('missing.json');

      expect(console.error).toHaveBeenCalledWith(
        '[sync]',
        'File not found for deletion: missing.json',
      );
    });

    it('should propagate other delete errors', async () => {
      const error = new Error('Permission denied');
      spyOn(SafService, 'deleteFile').and.returnValue(Promise.reject(error));

      await expectAsync(adapter.deleteFile('test.json')).toBeRejectedWith(error);
    });
  });

  describe('checkDirExists', () => {
    it('should check permission using SafService', async () => {
      spyOn(SafService, 'checkPermission').and.returnValue(Promise.resolve(true));

      const result = await adapter.checkDirExists?.('any-path');

      expect(SafService.checkPermission).toHaveBeenCalledWith(testUri);
      expect(result).toBe(true);
    });

    it('should return false when no permission', async () => {
      spyOn(SafService, 'checkPermission').and.returnValue(Promise.resolve(false));

      const result = await adapter.checkDirExists?.('any-path');

      expect(SafService.checkPermission).toHaveBeenCalledWith(testUri);
      expect(result).toBe(false);
    });

    it('should handle undefined URI', async () => {
      mockGetUri.and.returnValue(Promise.resolve(undefined));
      spyOn(SafService, 'checkPermission').and.returnValue(Promise.resolve(false));

      const result = await adapter.checkDirExists?.('any-path');

      expect(SafService.checkPermission).toHaveBeenCalledWith(undefined);
      expect(result).toBe(false);
    });
  });
});
