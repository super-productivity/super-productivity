import { msToClockString } from '../../ui/duration/ms-to-clock-string.pipe';
import { msToString } from '../../ui/duration/ms-to-string.pipe';
import { SharePayload } from './share.model';

/**
 * Data for creating a work summary share
 */
export interface WorkSummaryData {
  /** Total time spent in milliseconds */
  totalTimeSpent: number;
  /** Number of tasks completed */
  tasksCompleted: number;
  /** Optional: Date range for the summary */
  dateRange?: {
    start: string;
    end: string;
  };
  /** Optional: Top tasks by time spent */
  topTasks?: Array<{ title: string; timeSpent: number }>;
  /** Optional: Project name */
  projectName?: string;
  /** Optional: Detailed metrics table data */
  detailedMetrics?: {
    timeEstimate?: number;
    totalTasks?: number;
    daysWorked?: number;
    avgTasksPerDay?: number;
    avgBreakNr?: number;
    avgTimeSpentOnDay?: number;
    avgTimeSpentOnTask?: number;
    avgTimeSpentOnTaskIncludingSubTasks?: number;
    avgBreakTime?: number;
  };
}

/**
 * Options for formatting share content
 */
export interface ShareFormatterOptions {
  /** Include UTM parameters in the URL */
  includeUTM?: boolean;
  /** UTM source override (default: 'share') */
  utmSource?: string;
  /** UTM medium override (default: 'social') */
  utmMedium?: string;
  /** Base URL for the app (default: https://super-productivity.com) */
  baseUrl?: string;
  /** Maximum length for text (for Twitter, etc.) */
  maxLength?: number;
  /** Include hashtags */
  includeHashtags?: boolean;
}

const DEFAULT_BASE_URL = 'https://super-productivity.com';
const DEFAULT_UTM_SOURCE = 'share';
const DEFAULT_UTM_MEDIUM = 'social';
const TWITTER_MAX_LENGTH = 280;

/**
 * Formats work summary data into a shareable payload
 */
export class ShareFormatter {
  /**
   * Create a share payload from work summary data
   */
  static formatWorkSummary(
    data: WorkSummaryData,
    options: ShareFormatterOptions = {},
  ): SharePayload {
    const url = this._buildUrl(options);
    const text = this._buildWorkSummaryText(data, options);

    return {
      text,
      url,
      title: this._buildTitle(data),
    };
  }

  /**
   * Create a generic promotional share payload
   */
  static formatPromotion(
    customText?: string,
    options: ShareFormatterOptions = {},
  ): SharePayload {
    const url = this._buildUrl(options);
    const text =
      customText ||
      'Check out Super Productivity: a to-do list, time tracker and daily planner for focused work. Private, offline-first and open source.';

    return {
      text,
      url,
      title: 'Super Productivity',
    };
  }

  /**
   * Optimize payload for Twitter (character limit)
   */
  static optimizeForTwitter(payload: SharePayload): SharePayload {
    const { text } = payload;
    // Twitter counts URLs as 23 characters
    const urlLength = 23;
    const maxTextLength = TWITTER_MAX_LENGTH - urlLength - 1; // -1 for space

    let optimizedText = text || '';
    if (optimizedText.length > maxTextLength) {
      optimizedText = optimizedText.substring(0, maxTextLength - 3) + '...';
    }

    return {
      ...payload,
      text: optimizedText,
    };
  }

  private static _buildUrl(options: ShareFormatterOptions): string {
    const baseUrl = options.baseUrl || DEFAULT_BASE_URL;

    if (!options.includeUTM) {
      return baseUrl;
    }

    const utmSource = options.utmSource || DEFAULT_UTM_SOURCE;
    const utmMedium = options.utmMedium || DEFAULT_UTM_MEDIUM;

    const params = new URLSearchParams({
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: 'app_share',
    });

    return `${baseUrl}?${params.toString()}`;
  }

  private static _buildTitle(data: WorkSummaryData): string {
    if (data.projectName) {
      return `Work Summary - ${data.projectName}`;
    }
    return 'My Work Summary';
  }

  private static _buildWorkSummaryText(
    data: WorkSummaryData,
    options: ShareFormatterOptions,
  ): string {
    const parts: string[] = [];

    // Header with project name
    let header = '📊 ';
    if (data.projectName) {
      header += `${data.projectName} - `;
    }
    if (data.dateRange) {
      header += `${data.dateRange.start} to ${data.dateRange.end}`;
    } else {
      header += 'My productivity summary';
    }
    parts.push(header);
    parts.push('');

    // Detailed metrics table
    if (data.detailedMetrics) {
      const dm = data.detailedMetrics;

      parts.push(`⏱️ Time Spent: ${msToString(data.totalTimeSpent)}`);
      if (dm.timeEstimate) {
        parts.push(`📋 Time Estimated: ${msToString(dm.timeEstimate)}`);
      }
      parts.push(
        `✅ Tasks Done: ${data.tasksCompleted}${dm.totalTasks ? ` / ${dm.totalTasks}` : ''}`,
      );

      if (dm.daysWorked) {
        parts.push(`📅 Days Worked: ${dm.daysWorked}`);
      }
      if (dm.avgTasksPerDay) {
        parts.push(`📊 Avg Tasks/Day: ${dm.avgTasksPerDay.toFixed(1)}`);
      }
      if (dm.avgBreakNr !== undefined) {
        parts.push(`☕ Avg Breaks/Day: ${dm.avgBreakNr.toFixed(1)}`);
      }
      if (dm.avgTimeSpentOnDay) {
        parts.push(`⏳ Avg Time/Day: ${msToString(dm.avgTimeSpentOnDay)}`);
      }
      if (dm.avgTimeSpentOnTask) {
        parts.push(`⚡ Avg Time/Task: ${msToString(dm.avgTimeSpentOnTask)}`);
      }
      if (dm.avgBreakTime) {
        parts.push(`🧘 Avg Break Time: ${msToString(dm.avgBreakTime)}`);
      }
    } else {
      // Simple summary if no detailed metrics
      const timeStr = msToString(data.totalTimeSpent);
      const clockStr = msToClockString(data.totalTimeSpent);
      parts.push(`⏱️ ${timeStr} (${clockStr}) of focused work`);
      parts.push(`✅ ${data.tasksCompleted} tasks completed`);
    }

    // Top tasks (if provided and not too long)
    if (data.topTasks && data.topTasks.length > 0 && !options.maxLength) {
      parts.push('');
      parts.push('Top tasks:');
      data.topTasks.slice(0, 3).forEach((task) => {
        const taskTime = msToString(task.timeSpent);
        parts.push(`• ${task.title} (${taskTime})`);
      });
    }

    // Hashtags
    if (options.includeHashtags) {
      parts.push('\n#productivity #timetracking #SuperProductivity');
    }

    let text = parts.join('\n');

    // Apply max length if specified
    if (options.maxLength && text.length > options.maxLength) {
      text = text.substring(0, options.maxLength - 3) + '...';
    }

    return text;
  }
}
