export type TaskWidgetEdge = 'left' | 'right' | 'top' | 'bottom';
export type EdgeRect = { width: number; height: number; x: number; y: number };
export type EdgePoint = { x: number; y: number };
export type ClosestEdgeInfo = { edge: TaskWidgetEdge; distance: number };

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const isHorizontalEdge = (edge: TaskWidgetEdge): boolean =>
  edge === 'top' || edge === 'bottom';

export const getDockedX = (
  edge: TaskWidgetEdge,
  width: number,
  workArea: EdgeRect,
): number =>
  edge === 'left'
    ? workArea.x
    : edge === 'right'
      ? workArea.x + workArea.width - width
      : clamp(
          workArea.x + Math.round((workArea.width - width) / 2),
          workArea.x,
          workArea.x + workArea.width - width,
        );

export const getDockedBounds = (
  edge: TaskWidgetEdge,
  bounds: EdgeRect,
  workArea: EdgeRect,
): EdgeRect => {
  const x = clamp(bounds.x, workArea.x, workArea.x + workArea.width - bounds.width);
  const y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - bounds.height);
  return {
    ...bounds,
    x:
      edge === 'left'
        ? workArea.x
        : edge === 'right'
          ? workArea.x + workArea.width - bounds.width
          : x,
    y:
      edge === 'top'
        ? workArea.y
        : edge === 'bottom'
          ? workArea.y + workArea.height - bounds.height
          : y,
  };
};

export const getClosestEdgeInfo = (
  bounds: EdgeRect,
  workArea: EdgeRect,
): ClosestEdgeInfo => {
  const distances: ClosestEdgeInfo[] = [
    { edge: 'left', distance: Math.max(0, bounds.x - workArea.x) },
    {
      edge: 'right',
      distance: Math.max(0, workArea.x + workArea.width - (bounds.x + bounds.width)),
    },
    { edge: 'top', distance: Math.max(0, bounds.y - workArea.y) },
    {
      edge: 'bottom',
      distance: Math.max(0, workArea.y + workArea.height - (bounds.y + bounds.height)),
    },
  ];
  return distances.reduce((closest, item) =>
    item.distance < closest.distance ? item : closest,
  );
};

export const getClosestEdge = (bounds: EdgeRect, workArea: EdgeRect): TaskWidgetEdge =>
  getClosestEdgeInfo(bounds, workArea).edge;

export const getCollapsedEdgeBounds = (
  expandedBounds: EdgeRect,
  workArea: EdgeRect,
  edge: TaskWidgetEdge,
  collapsedWidth: number,
): EdgeRect => {
  const thickness = collapsedWidth;
  const length = Math.max(42, Math.round(collapsedWidth * 2));
  const width = length;
  const height = thickness;
  const bounds = {
    width,
    height,
    x:
      edge === 'left'
        ? workArea.x
        : edge === 'right'
          ? workArea.x + workArea.width - width
          : expandedBounds.x + Math.round((expandedBounds.width - width) / 2),
    y:
      edge === 'top'
        ? workArea.y
        : edge === 'bottom'
          ? workArea.y + workArea.height - height
          : expandedBounds.y + Math.round((expandedBounds.height - height) / 2),
  };
  return getDockedBounds(edge, bounds, workArea);
};

export const isPointInsideBounds = (point: EdgePoint, bounds: EdgeRect): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;
