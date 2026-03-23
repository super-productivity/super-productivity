import { msToString } from '../../../ui/duration/ms-to-string.pipe';

interface FormatScheduleDragPreviewLabelParams {
  formatTime: (timestamp: number) => string;
  startTimestamp: number;
  durationInHours?: number | null;
}

const MS_PER_HOUR = 60 * 60 * 1000;

export const formatScheduleDragPreviewLabel = ({
  durationInHours,
  formatTime,
  startTimestamp,
}: FormatScheduleDragPreviewLabelParams): string => {
  const startLabel = formatTime(startTimestamp);

  if (!durationInHours || durationInHours <= 0) {
    return startLabel;
  }

  const durationMs = Math.round(durationInHours * MS_PER_HOUR);
  if (durationMs <= 0) {
    return startLabel;
  }

  const endLabel = formatTime(startTimestamp + durationMs);
  const durationLabel = msToString(durationMs, false, true);

  return durationLabel
    ? `${startLabel} - ${endLabel} (${durationLabel})`
    : `${startLabel} - ${endLabel}`;
};
