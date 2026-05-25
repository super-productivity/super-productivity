import { devError } from './dev-error';
import { arrayEquals } from './array-equals';
import { Dictionary } from '@ngrx/entity';
import { Log } from '../core/log';

export const isEntityStateConsistent = <T extends Dictionary<any>>(
  data: T,
  additionalStr = '',
): boolean => {
  if (
    !data ||
    !data.entities ||
    !data.ids ||
    Object.keys(data.entities).length !== data.ids.length ||
    !arrayEquals(Object.keys(data.entities).sort(), [...data.ids].sort())
  ) {
    Log.log(
      `Inconsistent entity state "${additionalStr}": ids=${data?.ids?.length}, entities=${data?.entities ? Object.keys(data.entities).length : 0}`,
    );
    devError(`Inconsistent entity state "${additionalStr}"`);
    return false;
  }
  return true;
};

export const fixEntityStateConsistency = <T extends Dictionary<any>>(data: T): T => {
  if (
    !data ||
    !data.entities ||
    !data.ids ||
    Object.keys(data.entities).length !== data.ids.length ||
    !arrayEquals(Object.keys(data.entities).sort(), [...data.ids].sort())
  ) {
    Log.err(
      `FIXING ENTITY STATE: ids=${data?.ids?.length}, entities=${Object.keys(data.entities).length}`,
    );

    return {
      ...data,
      ids: Object.keys(data.entities),
    };
  }
  return data;
};

export const fixEntityStateConsistencyOrError = <T extends Dictionary<any>>(
  data: T,
): T => {
  if (
    !data ||
    !data.entities ||
    !data.ids ||
    Object.keys(data.entities).length !== data.ids.length ||
    !arrayEquals(Object.keys(data.entities).sort(), [...data.ids].sort())
  ) {
    Log.log(
      `Fixing entity state: ids=${data?.ids?.length}, entities=${Object.keys(data.entities).length}`,
    );

    return {
      ...data,
      ids: Object.keys(data.entities),
    };
  }

  throw new Error('Could not fix entity state');
};
