// Base mapped types with clearer names

// Re-export ArchiveModel for backward compatibility
export { ArchiveModel } from '../archive/archive.model';

export type TTModelId = string;
export type TTDate = string;

export type TTModelIdMap<T> = Omit<
  Record<TTModelId, T>,
  keyof TTWorkContextData | keyof TimeTrackingState | 'workStart' | 'workEnd'
>;
export type TTDateMap<T> = Omit<
  Record<TTDate, T>,
  keyof TTWorkContextData | keyof TimeTrackingState | 'workStart' | 'workEnd'
>;

/**
 * Time Tracking work context data
 * Uses shortened property names to reduce storage size
 * s: start time
 * e: end time
 * b: break number
 * bt: break time
 */
export interface TTWorkContextData {
  s?: number;
  e?: number;
  b?: number;
  bt?: number;
}

/*
project:
  [projectId]:
    [date]:
      s: number;
      ...

project: -> TTWorkContextSessionMap
  [projectId]: -> TTWorkSessionByDateMap
    [date]: -> TTWorkContextData
      s: number;
      ...
 */

// Map of work session stats by date
export type TTWorkSessionByDateMap = TTDateMap<TTWorkContextData>;

// Work context (project/tag) mapped to their session data by date
export type TTWorkContextSessionMap = TTModelIdMap<TTWorkSessionByDateMap>;

// Main state container
export interface TimeTrackingState {
  project: TTWorkContextSessionMap;
  tag: TTWorkContextSessionMap;
  // somehow can't be optional for ngrx
}

export const isWorkContextData = (obj: unknown): obj is TTWorkContextData =>
  typeof obj === 'object' &&
  obj !== null &&
  ('s' in obj || 'e' in obj || 'b' in obj || 'bt' in obj);
