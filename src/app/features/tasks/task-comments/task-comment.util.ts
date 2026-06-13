import { nanoid } from 'nanoid';
import { TaskComment } from '../task.model';

/** Returns a trimmed comment body or an empty string when input is only whitespace. */
export const normalizeTaskCommentBody = (body: string): string => body.trim();

/** True when the body is non-empty after trimming (proposal: ignore blank comments). */
export const isNonEmptyTaskCommentBody = (body: string): boolean =>
  normalizeTaskCommentBody(body).length > 0;

/** Chronological order for display (oldest first). */
export const sortTaskCommentsByCreated = (
  comments: readonly TaskComment[],
): TaskComment[] => [...comments].sort((a, b) => a.created - b.created);

export const createTaskComment = (body: string): TaskComment | null => {
  const normalizedBody = normalizeTaskCommentBody(body);
  if (!isNonEmptyTaskCommentBody(normalizedBody)) {
    return null;
  }
  return {
    id: nanoid(),
    body: normalizedBody,
    created: Date.now(),
  };
};

export const appendTaskComment = (
  comments: readonly TaskComment[] | undefined,
  body: string,
): TaskComment[] | null => {
  const comment = createTaskComment(body);
  if (!comment) {
    return null;
  }
  return [...(comments || []), comment];
};

export const updateTaskCommentInList = (
  comments: readonly TaskComment[],
  commentId: string,
  body: string,
): TaskComment[] | null => {
  const normalizedBody = normalizeTaskCommentBody(body);
  if (!isNonEmptyTaskCommentBody(normalizedBody)) {
    return null;
  }
  if (!comments.some((c) => c.id === commentId)) {
    return null;
  }
  const updatedAt = Date.now();
  return comments.map((c) =>
    c.id === commentId ? { ...c, body: normalizedBody, updated: updatedAt } : c,
  );
};

export const removeTaskCommentFromList = (
  comments: readonly TaskComment[],
  commentId: string,
): TaskComment[] | undefined => {
  const next = comments.filter((c) => c.id !== commentId);
  return next.length > 0 ? next : undefined;
};

export const wasTaskCommentEdited = (comment: TaskComment): boolean =>
  typeof comment.updated === 'number' && comment.updated > comment.created;
