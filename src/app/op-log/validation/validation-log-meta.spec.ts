import { getValidationFailureLogMeta } from './validation-log-meta';
import type { ValidationResult } from '../core/types/sync.types';

describe('getValidationFailureLogMeta', () => {
  it('should summarize validation failures without raw data values', () => {
    const privateTaskTitle = 'Private task title';
    const result = {
      success: false,
      data: {
        title: privateTaskTitle,
      },
      errors: [
        {
          path: '$input.task.entities["task-id"].title',
          expected: 'string',
          value: privateTaskTitle,
        },
      ],
    } as ValidationResult<unknown>;

    const meta = getValidationFailureLogMeta({
      context: 'task',
      result,
      inputData: {
        title: privateTaskTitle,
      },
      isEntityCheck: true,
    });

    expect(meta).toEqual(
      jasmine.objectContaining({
        context: 'task',
        success: false,
        isEntityCheck: true,
        errorCount: 1,
        firstErrorPath: '$input.task.entities["task-id"].title',
        firstErrorExpected: 'string',
        resultDataType: 'object',
        resultDataKeyCount: 1,
        inputDataType: 'object',
        inputDataKeyCount: 1,
      }),
    );
    expect(JSON.stringify(meta)).not.toContain(privateTaskTitle);
  });
});
