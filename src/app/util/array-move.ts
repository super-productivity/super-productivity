export const arrayMove = <T>(
  arrIN: T[],
  from: number,
  to: number,
  on: number = 1,
): T[] => {
  const arr = arrIN.slice(0);
  arr.splice(to, 0, ...arr.splice(from, on));
  return arr;
};

export const arrayMoveLeft = <T>(arr: T[], val: T): T[] => {
  const oldIndex = arr.indexOf(val);
  if (oldIndex === -1) {
    return arr;
  }

  const newIndex = oldIndex - 1;

  if (newIndex >= 0) {
    return arrayMove(arr, oldIndex, newIndex);
  }
  return arr;
};

export const arrayMoveRight = <T>(arr: T[], val: T): T[] => {
  const oldIndex = arr.indexOf(val);
  if (oldIndex === -1) {
    return arr;
  }

  const newIndex = oldIndex + 1;

  if (newIndex < arr.length) {
    return arrayMove(arr, oldIndex, newIndex);
  }
  return arr;
};

export const arrayMoveLeftUntil = <T>(
  arr: T[],
  val: T,
  skipDoneConditionFn: (item: T) => boolean,
): T[] => {
  const oldIndex = arr.indexOf(val);
  if (oldIndex === -1) {
    return arr;
  }
  let newIndex: number = oldIndex - 1;
  while (skipDoneConditionFn(arr[newIndex]) && newIndex > 0) {
    newIndex--;
  }

  if (newIndex >= 0) {
    return arrayMove(arr, oldIndex, newIndex);
  }
  return arr;
};

export const arrayMoveRightUntil = <T>(
  arr: T[],
  val: T,
  skipDoneConditionFn: (item: T) => boolean,
): T[] => {
  const oldIndex = arr.indexOf(val);
  if (oldIndex === -1) {
    return arr;
  }
  let newIndex: number = oldIndex + 1;
  while (skipDoneConditionFn(arr[newIndex]) && newIndex < arr.length) {
    newIndex++;
  }

  if (newIndex < arr.length) {
    return arrayMove(arr, oldIndex, newIndex);
  }
  return arr;
};

export const arrayMoveToStart = <T>(arr: T[], val: T): T[] => {
  const oldIndex = arr.indexOf(val);
  if (oldIndex === -1) {
    return arr;
  }

  return arrayMove(arr, oldIndex, 0);
};

export const arrayMoveToEnd = <T>(arr: T[], val: T): T[] => {
  const oldIndex = arr.indexOf(val);
  if (oldIndex === -1) {
    return arr;
  }

  return arrayMove(arr, oldIndex, arr.length - 1);
};
