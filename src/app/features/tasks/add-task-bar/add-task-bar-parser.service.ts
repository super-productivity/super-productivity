import { inject, Injectable } from '@angular/core';
import { Project } from '../../project/project.model';
import { Tag } from '../../tag/tag.model';
import { AddTaskBarStateService } from './add-task-bar-state.service';
import { AddTaskBarRepeat } from './add-task-bar.const';
import {
  SHORT_SYNTAX_REPEAT_REMOVAL_REG_EX,
  SHORT_SYNTAX_TIME_REG_EX,
  shortSyntax,
  ShortSyntaxRange,
  ShortSyntaxTokenType,
} from '../short-syntax';
import { ShortSyntaxConfig } from '../../config/global-config.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TimeSpentOnDay, TaskReminderOptionId } from '../task.model';
import { TaskAttachment } from '../task-attachment/task-attachment.model';
import { millisecondsDiffToRemindOption } from '../util/remind-option-to-milliseconds';

interface PreviousParseResult {
  cleanText: string | null;
  projectId: string | null;
  tagIds: string[];
  newTagTitles: string[];
  timeSpentOnDay: TimeSpentOnDay | null;
  timeEstimate: number | null;
  dueDate: string | null;
  dueTime: string | null;
  attachments: TaskAttachment[];
  deadlineDate: string | null;
  deadlineTime: string | null;
  deadlineRemindOption: TaskReminderOptionId | null;
  isDeadlineFromSyntax: boolean;
  repeat: AddTaskBarRepeat | null;
  isRepeatFromSyntax: boolean;
}

const isSameRepeat = (
  a: AddTaskBarRepeat | null,
  b: AddTaskBarRepeat | null,
): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  if (a.type !== b.type) {
    return false;
  }
  if (a.type === 'INTERVAL' && b.type === 'INTERVAL') {
    return a.repeatCycle === b.repeatCycle && a.repeatEvery === b.repeatEvery;
  }
  if (a.type === 'PRESET' && b.type === 'PRESET') {
    return a.quickSetting === b.quickSetting;
  }
  // both DIALOG
  return true;
};

@Injectable()
export class AddTaskBarParserService {
  private readonly _stateService = inject(AddTaskBarStateService);
  private _previousParseResult: PreviousParseResult | null = null;
  private _parseRunId = 0;
  // Exactly which characters of which input the parser last consumed, so a
  // "clear"/"pick" can delete a token without a second grammar guessing at its
  // extent. Pinned to the text it was computed for; a mismatch means the parse
  // for the current input has not landed yet and callers fall back.
  private _lastParsedRanges: { forText: string; ranges: ShortSyntaxRange[] } | null =
    null;

  private _arraysEqual<T>(a: T[], b: T[]): boolean {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  private _datesEqual(a: string | null, b: string | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a === b;
  }

  async parseAndUpdateText(
    text: string,
    config: ShortSyntaxConfig | null,
    allProjects: Project[],
    allTags: Tag[],
    defaultProject: Project,
    defaultDate?: string,
    defaultTime?: string,
  ): Promise<void> {
    const parseRunId = ++this._parseRunId;

    if (!text) {
      if (this._previousParseResult?.isDeadlineFromSyntax) {
        this._stateService.updateDeadline(null, null);
        this._stateService.updateDeadlineRemindOption(null);
      }
      if (this._previousParseResult?.isRepeatFromSyntax) {
        this._stateService.clearRepeatSetting();
      }
      this._stateService.updateSyntaxHighlight(null);
      this._previousParseResult = null;
      this._lastParsedRanges = null;
      return;
    }

    if (!config) {
      this._stateService.updateSyntaxHighlight(null);
      this._previousParseResult = null;
      this._lastParsedRanges = null;
      return;
    }

    // Get current tags from state to preserve pre-selected tags
    const parseResult = await shortSyntax(
      { title: text, tagIds: this._stateService.state().tagIdsFromTxt },
      config,
      allTags,
      allProjects,
      undefined,
      'replace',
      true,
    );

    if (parseRunId !== this._parseRunId) {
      return;
    }

    // Everything else is read after the await, not before it: a control pick
    // can land while the parse runs (the first one waits for the chrono-node
    // chunk), and a pick that leaves the text unchanged queues no parse to
    // supersede this one. A snapshot from before the await still holds the
    // values that pick replaced, and publishing them would undo it.
    const currentState = this._stateService.state();

    const parsedRanges = parseResult?.parsedRanges ?? [];
    this._lastParsedRanges = { forText: text, ranges: parsedRanges };
    this._stateService.updateSyntaxHighlight(
      parsedRanges.length
        ? {
            forText: text,
            ranges: parsedRanges,
          }
        : null,
    );

    // Create current parse result data structure
    let currentResult: PreviousParseResult;

    // On the first run _previousParseResult is null. Treat "no previous run"
    // as "user owns the deadline" so an existing user-set deadline isn't
    // wiped on first parse.
    const wasDeadlineFromSyntax =
      this._previousParseResult?.isDeadlineFromSyntax ?? false;
    // Same ownership rule for the repeat setting (menu-selected vs "@every ...")
    const wasRepeatFromSyntax = this._previousParseResult?.isRepeatFromSyntax ?? false;
    const isDateExplicitlyCleared = currentState.isDateExplicitlyCleared === true;
    const defaultDueDate = isDateExplicitlyCleared
      ? null
      : currentState.date || defaultDate || null;
    const defaultDueTime = isDateExplicitlyCleared
      ? null
      : currentState.time || defaultTime || null;

    if (!parseResult) {
      // No parse result means no short syntax found
      // Preserve current user-selected values instead of falling back to defaults

      currentResult = {
        cleanText: text,
        projectId: this._stateService.isAutoDetected()
          ? defaultProject?.id || null
          : null,
        tagIds: currentState.tagIdsFromTxt, // Preserve pre-selected tags
        newTagTitles: [],
        timeSpentOnDay: null,
        timeEstimate: null,
        // Preserve current date/time if user has selected them, otherwise use defaults.
        // But if the user explicitly cleared a default date, keep it cleared.
        dueDate: defaultDueDate,
        dueTime: defaultDueTime,
        attachments: [],
        deadlineDate: wasDeadlineFromSyntax ? null : currentState.deadlineDate || null,
        deadlineTime: wasDeadlineFromSyntax ? null : currentState.deadlineTime || null,
        deadlineRemindOption: wasDeadlineFromSyntax
          ? null
          : currentState.deadlineRemindOption || null,
        isDeadlineFromSyntax: false,
        repeat: wasRepeatFromSyntax ? null : currentState.repeat || null,
        isRepeatFromSyntax: false,
      };
    } else {
      // Extract parsed values
      const tagIds = parseResult.taskChanges.tagIds || currentState.tagIdsFromTxt;
      const newTagTitles = parseResult.newTagTitles || currentState.newTagTitles;

      let dueDate: string | null = null;
      let dueTime: string | null = null;

      if (parseResult.taskChanges.dueWithTime) {
        const dueDateObj = new Date(parseResult.taskChanges.dueWithTime);
        dueDate = getDbDateStr(dueDateObj);

        if (parseResult.taskChanges.hasPlannedTime !== false) {
          const hours = dueDateObj.getHours().toString().padStart(2, '0');
          const minutes = dueDateObj.getMinutes().toString().padStart(2, '0');
          // Prefer the typed wall-clock time: when the resolved day is a DST
          // spring-forward day the timestamp reads back an hour shifted, and
          // this string becomes the repeat config's startTime.
          const timeStr = parseResult.taskChanges.dueTimeStr ?? `${hours}:${minutes}`;

          if (timeStr !== '00:00') {
            dueTime = timeStr;
          }
        }
      } else if (defaultDueDate) {
        dueDate = defaultDueDate;
        dueTime = defaultDueTime;
      }

      let deadlineDate: string | null = null;
      let deadlineTime: string | null = null;
      let deadlineRemindOption: TaskReminderOptionId | null = null;
      const hasParsedDeadline =
        parseResult.taskChanges.deadlineWithTime !== undefined ||
        parseResult.taskChanges.deadlineDay !== undefined;

      if (parseResult.taskChanges.deadlineWithTime) {
        const deadlineDateObj = new Date(parseResult.taskChanges.deadlineWithTime);
        deadlineDate = getDbDateStr(deadlineDateObj);

        if (parseResult.taskChanges.hasDeadlineTime !== false) {
          const hours = deadlineDateObj.getHours().toString().padStart(2, '0');
          const minutes = deadlineDateObj.getMinutes().toString().padStart(2, '0');
          const timeStr = `${hours}:${minutes}`;

          if (timeStr !== '00:00') {
            deadlineTime = timeStr;
          }
        }

        if (parseResult.taskChanges.deadlineRemindAt) {
          deadlineRemindOption = millisecondsDiffToRemindOption(
            parseResult.taskChanges.deadlineWithTime,
            parseResult.taskChanges.deadlineRemindAt,
          );
        }
      } else if (parseResult.taskChanges.deadlineDay) {
        deadlineDate = parseResult.taskChanges.deadlineDay;
      } else if (!wasDeadlineFromSyntax) {
        deadlineDate = currentState.deadlineDate || null;
        deadlineTime = currentState.deadlineTime || null;
        deadlineRemindOption = currentState.deadlineRemindOption || null;
      }

      let repeat: AddTaskBarRepeat | null;
      if (parseResult.repeat) {
        repeat = parseResult.repeat;
      } else if (wasRepeatFromSyntax) {
        repeat = null;
      } else {
        repeat = currentState.repeat || null;
      }

      currentResult = {
        cleanText: parseResult.taskChanges.title || text,
        projectId: parseResult.projectId || null,
        tagIds: tagIds,
        newTagTitles: newTagTitles,
        timeSpentOnDay: parseResult.taskChanges.timeSpentOnDay || null,
        timeEstimate: parseResult.taskChanges.timeEstimate || null,
        dueDate: dueDate,
        dueTime: dueTime,
        attachments: parseResult.attachments || [],
        deadlineDate: deadlineDate,
        deadlineTime: deadlineTime,
        deadlineRemindOption: deadlineRemindOption,
        isDeadlineFromSyntax: hasParsedDeadline,
        repeat,
        isRepeatFromSyntax: !!parseResult.repeat,
      };
    }

    // Compare with previous result and only update changed values
    if (
      !this._previousParseResult ||
      this._previousParseResult.cleanText !== currentResult.cleanText
    ) {
      this._stateService.updateCleanText(currentResult.cleanText);
    }

    if (
      !this._previousParseResult ||
      this._previousParseResult.projectId !== currentResult.projectId
    ) {
      if (currentResult.projectId) {
        const foundProject = allProjects.find((p) => p.id === currentResult.projectId);
        if (foundProject) {
          this._stateService.setAutoDetectedProjectId(foundProject.id);
        }
      } else if (this._stateService.isAutoDetected()) {
        if (defaultProject?.id) {
          this._stateService.updateProjectId(defaultProject.id);
        }
      }
    }

    if (
      !this._previousParseResult ||
      !this._arraysEqual(this._previousParseResult.tagIds, currentResult.tagIds)
    ) {
      this._stateService.updateTagIdsFromTxt(currentResult.tagIds);
    }

    if (
      !this._previousParseResult ||
      !this._arraysEqual(
        this._previousParseResult.newTagTitles,
        currentResult.newTagTitles,
      )
    ) {
      this._stateService.updateNewTagTitles(currentResult.newTagTitles);
    }

    const prevTimeSpentOnDay = this._previousParseResult?.timeSpentOnDay || null;
    const currTimeSpentOnDay = currentResult.timeSpentOnDay;

    if (
      !this._previousParseResult ||
      // Check for field existence change
      (prevTimeSpentOnDay === null) !== (currTimeSpentOnDay === null) ||
      // Check for any discrepancy between all recorded time spent
      (prevTimeSpentOnDay !== null &&
        currTimeSpentOnDay !== null &&
        (Object.keys(prevTimeSpentOnDay).length !==
          Object.keys(currTimeSpentOnDay).length ||
          Object.keys(prevTimeSpentOnDay).some(
            (k) => prevTimeSpentOnDay[k] !== currTimeSpentOnDay[k],
          )))
    ) {
      this._stateService.updateSpent(currentResult.timeSpentOnDay);
    }

    if (
      (!this._previousParseResult && currentResult.timeEstimate !== null) ||
      (this._previousParseResult &&
        this._previousParseResult.timeEstimate !== currentResult.timeEstimate)
    ) {
      this._stateService.updateEstimate(currentResult.timeEstimate);
    }

    const dateChanged =
      !this._previousParseResult ||
      !this._datesEqual(this._previousParseResult.dueDate, currentResult.dueDate) ||
      this._previousParseResult.dueTime !== currentResult.dueTime;

    if (dateChanged) {
      this._stateService.updateDate(currentResult.dueDate, currentResult.dueTime);
    }

    if (
      !this._previousParseResult ||
      !this._arraysEqual(this._previousParseResult.attachments, currentResult.attachments)
    ) {
      this._stateService.updateAttachments(currentResult.attachments);
    }

    const deadlineChanged =
      !this._previousParseResult ||
      !this._datesEqual(
        this._previousParseResult.deadlineDate,
        currentResult.deadlineDate,
      ) ||
      this._previousParseResult.deadlineTime !== currentResult.deadlineTime;

    if (deadlineChanged) {
      this._stateService.updateDeadline(
        currentResult.deadlineDate,
        currentResult.deadlineTime,
      );
    }

    if (
      !this._previousParseResult ||
      this._previousParseResult.deadlineRemindOption !==
        currentResult.deadlineRemindOption ||
      currentState.deadlineRemindOption !== currentResult.deadlineRemindOption
    ) {
      this._stateService.updateDeadlineRemindOption(currentResult.deadlineRemindOption);
    }

    if (
      !this._previousParseResult ||
      !isSameRepeat(this._previousParseResult.repeat, currentResult.repeat)
    ) {
      if (currentResult.repeat) {
        this._stateService.updateRepeatSetting(currentResult.repeat);
      } else if (currentState.repeat) {
        this._stateService.clearRepeatSetting();
      }
    }

    // Store current result as previous for next comparison
    this._previousParseResult = currentResult;
  }

  resetPreviousResult(): void {
    this._parseRunId++;
    this._previousParseResult = null;
  }

  /**
   * Applies a value the user picked in one of the add-bar's controls, and takes
   * the syntax that said otherwise out of the input.
   *
   * All four picks below go through the same three steps, which only work
   * together:
   *
   * 1. Strip the syntax the pick overrides, so the text cannot keep advertising
   *    a value the task will not get.
   * 2. Discard an in-flight parse when that strip changed the text. It was
   *    started for the pre-strip input, so its values are already stale, and it
   *    would otherwise land between here and the parse the strip queues —
   *    overwriting both the pick and the ownership record below. The queued
   *    parse recomputes everything it would have published.
   * 3. Record the pick as the previous parse result, so the queued parse reads
   *    the vanished syntax as "the user replaced it" rather than "the user
   *    deleted their syntax", which would clear the value instead of keeping it.
   */
  applyUserRepeatPick(repeat: AddTaskBarRepeat): void {
    const cleanedInput = this._stripSyntaxForUserPick('repeat');
    this._recordUserPick({ repeat, isRepeatFromSyntax: false });
    this._stateService.updateRepeatSetting(repeat, cleanedInput);
  }

  applyUserDatePick(
    date: string,
    time: string | null,
    remindOption: TaskReminderOptionId | null,
  ): void {
    const cleanedInput = this._stripSyntaxForUserPick('date');
    // A recurrence phrase is due syntax, so the strip above may have taken one
    // with it — but the user changed the date, not the schedule. Keep the
    // recurrence by taking ownership of it too; it re-anchors to the new date.
    const repeat = this._stateService.state().repeat;
    this._recordUserPick({
      dueDate: date,
      dueTime: time,
      ...(repeat ? { repeat, isRepeatFromSyntax: false } : {}),
    });
    this._stateService.updateDate(date, time, cleanedInput);
    // No UI access to a reminder without a time being set
    this._stateService.updateRemindOption(remindOption);
  }

  applyUserDeadlinePick(
    date: string,
    time: string | null,
    remindOption: TaskReminderOptionId | null,
  ): void {
    const cleanedInput = this._stripSyntaxForUserPick('deadline');
    this._recordUserPick({
      deadlineDate: date,
      deadlineTime: time,
      deadlineRemindOption: remindOption,
      isDeadlineFromSyntax: false,
    });
    this._stateService.updateDeadline(date, time, cleanedInput);
    this._stateService.updateDeadlineRemindOption(remindOption);
  }

  applyUserEstimatePick(estimate: number): void {
    const cleanedInput = this._stripSyntaxForUserPick('estimate');
    // The estimate has no ownership flag — the parse simply reports what the
    // text says — so record the null a parse of the stripped input produces.
    // That makes the queued parse a no-op instead of a reset to null.
    this._recordUserPick({ timeEstimate: null });
    this._stateService.updateEstimate(estimate, cleanedInput);
  }

  private _stripSyntaxForUserPick(
    type: 'date' | 'deadline' | 'estimate' | 'repeat',
  ): string {
    const currentInput = this._stateService.inputTxt();
    const cleanedInput = this.removeShortSyntaxFromInput(currentInput, type);
    if (cleanedInput !== currentInput) {
      // Only safe because the changed text queues a parse that supersedes the
      // discarded one; without a strip there is no such parse to rely on.
      this._parseRunId++;
    }
    return cleanedInput;
  }

  private _recordUserPick(fields: Partial<PreviousParseResult>): void {
    if (this._previousParseResult) {
      this._previousParseResult = { ...this._previousParseResult, ...fields };
    }
  }

  /**
   * Deletes the characters the last parse consumed for `type` from `text`.
   *
   * Returns null when the recorded ranges are not for this exact text, leaving
   * the caller on its regex fallback. The ranges are the only description of a
   * token's real extent: a whitespace-delimited fallback truncates every
   * multi-word one ("@next friday" → "friday", "@every 2 fridays" → "2
   * fridays"), which is worse than not clearing at all — the leftover words
   * stay in the task title.
   */
  private _removeParsedRanges(text: string, type: ShortSyntaxTokenType): string | null {
    if (!this._lastParsedRanges || this._lastParsedRanges.forText !== text) {
      return null;
    }
    const ranges = this._lastParsedRanges.ranges.filter((r) => r.type === type);
    if (!ranges.length) {
      return text;
    }
    // Back to front so an earlier deletion cannot shift a later range
    return [...ranges]
      .sort((a, b) => b.start - a.start)
      .reduce((acc, r) => acc.slice(0, r.start) + acc.slice(r.end), text);
  }

  /**
   * Text with the recurrence syntax taken out.
   *
   * A recurrence parsed from the text owns its whole due token: the phrase plus
   * any adjacent time the token absorbed ("@every friday 3pm"), which the
   * phrase grammar on its own cannot see. Deleting only the phrase orphans that
   * time, and it ends up in the title of both the task and its repeat config.
   *
   * Only the recurrence is this control's to remove, so a current parse that
   * found none leaves the text alone — a "@tomorrow" the user typed is a plain
   * date, not something a recurrence pick overrides. When no parse has landed
   * for this exact text, the derived grammar is the only description of the
   * phrase's extent available, and it can match the phrase alone.
   */
  private _removeRepeatSyntax(text: string): string {
    if (
      this._lastParsedRanges?.forText === text &&
      !this._previousParseResult?.isRepeatFromSyntax
    ) {
      return text;
    }
    return (
      this._removeParsedRanges(text, 'due') ??
      text.replace(SHORT_SYNTAX_REPEAT_REMOVAL_REG_EX, '')
    );
  }

  removeShortSyntaxFromInput(
    currentInput: string,
    type: 'tags' | 'date' | 'estimate' | 'deadline' | 'repeat',
    specificTag?: string,
  ): string {
    if (!currentInput) return currentInput;

    let cleanedInput = currentInput;

    switch (type) {
      case 'tags':
        if (specificTag) {
          // Remove specific tag (e.g., #tagname). Stays token-based: the ranges
          // record which characters were tags, not which tag they named.
          const tagRegex = new RegExp(`\\s*#${specificTag}\\b`, 'gi');
          cleanedInput = cleanedInput.replace(tagRegex, '');
        } else {
          // Remove all tags (e.g., #tag1 #tag2)
          cleanedInput =
            this._removeParsedRanges(cleanedInput, 'tag') ??
            cleanedInput.replace(/\s*#\w+/g, '');
        }
        break;

      case 'date':
        // Remove due syntax (e.g., @today, @next friday, @every 2 fridays). A
        // recurrence phrase is due syntax too — it is the token that set the
        // date — so clearing the date drops it as well; callers that mean to
        // keep the recurrence take ownership of it first.
        cleanedInput =
          this._removeParsedRanges(cleanedInput, 'due') ??
          cleanedInput.replace(/\s*@\S+/g, '');
        break;

      case 'deadline':
        // Remove deadline date and time syntax (e.g., !today !16:30 !2024-01-15)
        cleanedInput =
          this._removeParsedRanges(cleanedInput, 'deadline') ??
          cleanedInput.replace(/\s*!\S+/g, '');
        break;

      case 'repeat':
        // Remove recurrence syntax (e.g., @daily @every friday @every 2 weeks).
        cleanedInput = this._removeRepeatSyntax(cleanedInput);
        break;

      case 'estimate':
        // Remove estimate syntax (e.g., t30m, 1h, 30m/1h, t1.5h)
        cleanedInput =
          this._removeParsedRanges(cleanedInput, 'estimate') ??
          cleanedInput.replace(new RegExp(SHORT_SYNTAX_TIME_REG_EX.source, 'gi'), ' ');
        break;
    }

    // Clean up extra whitespace
    return cleanedInput.replace(/\s+/g, ' ').trim();
  }
}
