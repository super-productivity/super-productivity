export const MAX_CAPTURE_TITLE_LENGTH = 500;
export const MAX_CAPTURE_NOTES_LENGTH = 8 * 1024;

export interface AssistantCaptureInput {
  title: string;
  notes?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Accepts exactly `{title, notes?}` within the limits the main process enforces. */
export const parseAssistantCaptureInput = (
  body: unknown,
): AssistantCaptureInput | undefined => {
  if (!isRecord(body) || Object.keys(body).some((k) => k !== 'title' && k !== 'notes')) {
    return undefined;
  }
  const { title, notes } = body;
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > MAX_CAPTURE_TITLE_LENGTH
  ) {
    return undefined;
  }
  if (
    notes !== undefined &&
    (typeof notes !== 'string' || notes.length > MAX_CAPTURE_NOTES_LENGTH)
  ) {
    return undefined;
  }
  return { title: title.trim(), ...(notes ? { notes } : {}) };
};
