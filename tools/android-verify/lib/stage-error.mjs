/**
 * A harness step that failed before the scenario could measure anything.
 * The runner records `stage` in the JSON and saves `<scenario>-fail-<stage>.png`.
 */
export class StageError extends Error {
  constructor(stage, message, details = {}) {
    super(message);
    this.name = 'StageError';
    this.stage = stage;
    this.details = details;
  }
}
