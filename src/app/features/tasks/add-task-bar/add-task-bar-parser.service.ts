import { inject, Injectable } from '@angular/core';
import { Project } from '../../project/project.model';
import { Tag } from '../../tag/tag.model';
import { AddTaskBarStateService } from './add-task-bar-state.service';
import { SHORT_SYNTAX_TIME_REG_EX, shortSyntax } from '../short-syntax';
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
  isParsedDueDate: boolean;
  attachments: TaskAttachment[];
  deadlineDate: string | null;
  deadlineTime: string | null;
  isParsedDeadline: boolean;
  deadlineRemindOption: TaskReminderOptionId | null;
}

const _extractDateAndTime = (
  timestamp: number,
  hasTime: boolean,
): readonly [string, string | null] => {
  const dateObj = new Date(timestamp);
  const timeStr = [dateObj.getHours(), dateObj.getMinutes()]
    .map((v) => v.toString().padStart(2, '0'))
    .join(':');

  return [getDbDateStr(dateObj), hasTime && timeStr !== '00:00' ? timeStr : null];
};

@Injectable()
export class AddTaskBarParserService {
  private readonly _stateService = inject(AddTaskBarStateService);
  private _previousParseResult: PreviousParseResult | null = null;
  private _parseRunId = 0;

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

    if (!text || !config) {
      this._previousParseResult = null;
      return;
    }

    // Get current tags from state to preserve pre-selected tags
    const currentState = this._stateService.state();
    const parseResult = await shortSyntax(
      { title: text, tagIds: currentState.tagIdsFromTxt },
      config,
      allTags,
      allProjects,
      undefined,
      'replace',
    );

    if (parseRunId !== this._parseRunId) {
      return;
    }

    // Create current parse result data structure
    let currentResult: PreviousParseResult;
    const previousHadParsedDate = this._previousParseResult?.isParsedDueDate ?? false;
    const previousHadParsedDeadline =
      this._previousParseResult?.isParsedDeadline ?? false;
    const dueDateFallback = previousHadParsedDate
      ? defaultDate || null
      : currentState.date || defaultDate || null;
    const dueTimeFallback = previousHadParsedDate
      ? defaultTime || null
      : currentState.time || defaultTime || null;
    const deadlineDateFallback = previousHadParsedDeadline
      ? null
      : currentState.deadlineDate || null;
    const deadlineTimeFallback = previousHadParsedDeadline
      ? null
      : currentState.deadlineTime || null;
    const deadlineRemindFallback = previousHadParsedDeadline
      ? null
      : currentState.deadlineRemindOption || null;

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
        // Preserve current date/time if user has selected them, otherwise use defaults
        dueDate: dueDateFallback,
        dueTime: dueTimeFallback,
        isParsedDueDate: false,
        attachments: [],
        deadlineDate: deadlineDateFallback,
        deadlineTime: deadlineTimeFallback,
        isParsedDeadline: false,
        deadlineRemindOption: deadlineRemindFallback,
      };
    } else {
      // Extract parsed values
      const tagIds = parseResult.taskChanges.tagIds || currentState.tagIdsFromTxt;
      const newTagTitles = parseResult.newTagTitles || currentState.newTagTitles;

      let dueDate: string | null = dueDateFallback;
      let dueTime: string | null = dueTimeFallback;
      const isParsedDueDate = !!parseResult.taskChanges.dueWithTime;

      if (parseResult.taskChanges.dueWithTime) {
        [dueDate, dueTime] = _extractDateAndTime(
          parseResult.taskChanges.dueWithTime,
          parseResult.taskChanges.hasPlannedTime !== false,
        );
      } else if (!dueDate && defaultDate) {
        dueDate = defaultDate;
        dueTime = defaultTime || null;
      }

      let deadlineDate: string | null = deadlineDateFallback;
      let deadlineTime: string | null = deadlineTimeFallback;
      let deadlineRemindOption: TaskReminderOptionId | null = deadlineRemindFallback;
      const isParsedDeadline = !!(
        parseResult.taskChanges.deadlineWithTime || parseResult.taskChanges.deadlineDay
      );

      if (parseResult.taskChanges.deadlineWithTime) {
        [deadlineDate, deadlineTime] = _extractDateAndTime(
          parseResult.taskChanges.deadlineWithTime,
          parseResult.taskChanges.hasDeadlineTime !== false,
        );

        if (parseResult.taskChanges.deadlineRemindAt) {
          deadlineRemindOption = millisecondsDiffToRemindOption(
            parseResult.taskChanges.deadlineWithTime,
            parseResult.taskChanges.deadlineRemindAt,
          );
        }
      } else if (parseResult.taskChanges.deadlineDay) {
        deadlineDate = parseResult.taskChanges.deadlineDay;
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
        isParsedDueDate,
        attachments: parseResult.attachments || [],
        deadlineDate: deadlineDate,
        deadlineTime: deadlineTime,
        isParsedDeadline,
        deadlineRemindOption: deadlineRemindOption,
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
        currentResult.deadlineRemindOption
    ) {
      this._stateService.updateDeadlineRemindOption(currentResult.deadlineRemindOption);
    }

    // Store current result as previous for next comparison
    this._previousParseResult = currentResult;
  }

  resetPreviousResult(): void {
    this._parseRunId++;
    this._previousParseResult = null;
  }

  removeShortSyntaxFromInput(
    currentInput: string,
    type: 'tags' | 'date' | 'estimate' | 'urls' | 'deadline',
    specificTag?: string,
  ): string {
    if (!currentInput) return currentInput;

    let cleanedInput = currentInput;

    switch (type) {
      case 'tags':
        if (specificTag) {
          // Remove specific tag (e.g., #tagname)
          const tagRegex = new RegExp(`\\s*#${specificTag}\\b`, 'gi');
          cleanedInput = cleanedInput.replace(tagRegex, '');
        } else {
          // Remove all tags (e.g., #tag1 #tag2)
          cleanedInput = cleanedInput.replace(/\s*#\w+/g, '');
        }
        break;

      case 'date':
        // Remove date and time syntax (e.g., @today @16:30 @2024-01-15)
        cleanedInput = cleanedInput.replace(/\s*@\S+/g, '');
        break;

      case 'deadline':
        // Remove deadline date and time syntax (e.g., !today !16:30 !2024-01-15)
        cleanedInput = cleanedInput.replace(/\s*!\S+/g, '');
        break;

      case 'estimate':
        // Remove estimate syntax (e.g., t30m, 1h, 30m/1h, t1.5h)
        cleanedInput = cleanedInput.replace(
          new RegExp(SHORT_SYNTAX_TIME_REG_EX.source, 'gi'),
          ' ',
        );
        break;

      case 'urls':
        // Remove URL syntax (e.g., https://example.com www.example.com file:///path)
        cleanedInput = cleanedInput.replace(
          /(?:(?:https?|file):\/\/\S+|www\.\S+?)(?=\s|$)/gi,
          '',
        );
        break;
    }

    // Clean up extra whitespace
    return cleanedInput.replace(/\s+/g, ' ').trim();
  }
}
