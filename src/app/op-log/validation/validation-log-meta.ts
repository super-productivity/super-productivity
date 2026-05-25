import type { SyncLogMeta } from '@sp/sync-core';
import type { ValidationResult } from '../core/types/sync.types';

const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const getObjectKeyCount = (value: unknown): number | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).length
    : undefined;

const getArrayLength = (value: unknown): number | undefined =>
  Array.isArray(value) ? value.length : undefined;

export const getValidationFailureLogMeta = <R>({
  context,
  result,
  inputData,
  isEntityCheck,
}: {
  context: string;
  result: ValidationResult<R>;
  inputData?: unknown;
  isEntityCheck?: boolean;
}): SyncLogMeta => {
  if (result.success) {
    return {
      context,
      success: true,
      isEntityCheck,
    };
  }

  const firstError = result.errors[0];

  return {
    context,
    success: false,
    isEntityCheck,
    errorCount: result.errors.length,
    firstErrorPath: firstError?.path,
    firstErrorExpected: firstError?.expected,
    resultDataType: getValueType(result.data),
    resultDataKeyCount: getObjectKeyCount(result.data),
    resultDataArrayLength: getArrayLength(result.data),
    inputDataType: inputData === undefined ? undefined : getValueType(inputData),
    inputDataKeyCount: getObjectKeyCount(inputData),
    inputDataArrayLength: getArrayLength(inputData),
  };
};
