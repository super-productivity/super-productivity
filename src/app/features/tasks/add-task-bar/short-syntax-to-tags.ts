import { shortSyntax } from '../short-syntax';
import { msToString } from '../../../ui/duration/ms-to-string.pipe';
import {
  DEFAULT_PROJECT_COLOR,
  DEFAULT_TAG_COLOR,
  DEFAULT_TODAY_TAG_COLOR,
} from '../../work-context/work-context.const';
import { Tag } from '../../tag/tag.model';
import { Project } from '../../project/project.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { ShortSyntaxConfig } from '../../config/global-config.model';
import { TaskLog } from '../../../core/log';

export interface ShortSyntaxTag {
  title: string;
  color: string;
  icon: string;
  // needed for add task bar
  projectId?: string;
}

export const shortSyntaxToTags = async ({
  val,
  tags,
  projects,
  defaultColor,
  shortSyntaxConfig,
}: {
  val: string;
  tags: Tag[];
  projects: Project[];
  defaultColor: string;
  shortSyntaxConfig: ShortSyntaxConfig;
}): Promise<ShortSyntaxTag[]> => {
  const r = await shortSyntax(
    {
      title: val,
      tagIds: [],
      projectId: undefined,
    },
    shortSyntaxConfig,
    tags,
    projects,
  );
  const shortSyntaxTags: ShortSyntaxTag[] = [];

  if (!r) {
    return [];
  }

  if (r.projectId) {
    const project = projects.find((p) => p.id === r.projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    shortSyntaxTags.push({
      title: project.title,
      color: project.theme?.primary || DEFAULT_PROJECT_COLOR,
      projectId: r.projectId,
      icon: 'list',
    });
  }

  if (r.taskChanges.timeEstimate) {
    let time = msToString(r.taskChanges.timeEstimate);

    if (r.taskChanges.timeSpentOnDay && r.taskChanges.timeSpentOnDay[getDbDateStr()]) {
      time = msToString(r.taskChanges.timeSpentOnDay[getDbDateStr()]) + '/' + time;
    }
    TaskLog.log(time);

    shortSyntaxTags.push({
      title: time,
      color: defaultColor,
      icon: 'timer',
    });
  }
  if (r.taskChanges.dueWithTime) {
    let displayedDayStr: string;
    const { dueWithTime } = r.taskChanges;
    const plannedDate = new Date(dueWithTime);
    const hour = plannedDate.getHours();
    const minute = plannedDate.getMinutes();
    const hh = hour < 10 ? `0${hour}` : hour.toString();
    const mm = minute < 10 ? `0${minute}` : minute.toString();
    const displayedTimeStr = `${hh}:${mm}`;
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    // Check if the scheduled date is today
    if (
      today.getFullYear() === plannedDate.getFullYear() &&
      today.getMonth() === plannedDate.getMonth() &&
      today.getDate() === plannedDate.getDate()
    ) {
      displayedDayStr = `Today`;
    }
    // Check if the scheduled date is tomorrow
    else if (
      tomorrow.getFullYear() === plannedDate.getFullYear() &&
      tomorrow.getMonth() === plannedDate.getMonth() &&
      tomorrow.getDate() === plannedDate.getDate()
    ) {
      displayedDayStr = `Tomorrow`;
    } else {
      const weekdays = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
      displayedDayStr = `${weekdays[plannedDate.getDay()]}`;
    }
    const displayedDateStr = `${displayedDayStr}${r.taskChanges?.hasPlannedTime === false ? '' : ', ' + displayedTimeStr}`;
    shortSyntaxTags.push({
      title: displayedDateStr,
      color: defaultColor,
      icon: 'event',
    });
  }
  // if(due){
  //   shortSyntaxTags.push({
  //     // title: tag.title,
  //     title: 'due:12/12/20 9:00',
  //     color: defaultColor,
  //     icon: 'alarm'
  //   });
  // }

  if (r.taskChanges.tagIds) {
    r.taskChanges.tagIds.forEach((tagId) => {
      const tag = tags.find((p) => p.id === tagId);
      if (!tag) {
        throw new Error('Tag not found');
      }
      shortSyntaxTags.push({
        title: tag.title,
        color: tag.color || tag.theme?.primary || DEFAULT_TAG_COLOR,
        icon: tag.icon || 'style',
      });
    });
  }

  if (r.newTagTitles) {
    r.newTagTitles
      .filter((value, index, self) => self.indexOf(value) === index) // Filter out duplicates
      .forEach((tagTitle) => {
        shortSyntaxTags.push({
          title: tagTitle,
          color: DEFAULT_TODAY_TAG_COLOR,
          icon: 'style',
        });
      });
  }
  return shortSyntaxTags;
};
