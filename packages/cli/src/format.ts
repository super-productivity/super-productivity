import { Project, StatusResponse, Tag, Task } from './types';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const check = (done: boolean): string => (done ? `${GREEN}\u2713${RESET}` : '\u2022');

function msToHuman(ms: number): string {
  if (ms <= 0) return '0m';
  let h = Math.floor(ms / 3_600_000);
  let m = Math.round((ms % 3_600_000) / 60_000);
  if (m === 60) {
    h++;
    m = 0;
  }
  if (h > 0 && m > 0) return `${h}h${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function formatTask(t: Task): string {
  const lines: string[] = [];
  lines.push(`${check(t.isDone)} ${BOLD}${t.title}${RESET}  ${DIM}${t.id}${RESET}`);
  if (t.notes) lines.push(`  ${DIM}Notes:${RESET} ${t.notes.slice(0, 120)}`);
  if (t.projectId) lines.push(`  ${DIM}Project:${RESET} ${t.projectId}`);
  if (t.tagIds.length) lines.push(`  ${DIM}Tags:${RESET} ${t.tagIds.join(', ')}`);
  if (t.dueDay) lines.push(`  ${DIM}Due:${RESET} ${t.dueDay}`);
  if (t.timeEstimate || t.timeSpent) {
    const est = t.timeEstimate ? msToHuman(t.timeEstimate) : '-';
    const spent = t.timeSpent ? msToHuman(t.timeSpent) : '-';
    lines.push(`  ${DIM}Time:${RESET} ${spent} / ${est}`);
  }
  if (t.subTaskIds.length) lines.push(`  ${DIM}Subtasks:${RESET} ${t.subTaskIds.length}`);
  return lines.join('\n');
}

export function formatTaskList(tasks: Task[]): string {
  if (!tasks.length) return 'No tasks found.';
  return tasks
    .map((t) => `${check(t.isDone)} ${t.title}  ${DIM}${t.id}${RESET}`)
    .join('\n');
}

export function formatStatus(s: StatusResponse): string {
  const current = s.currentTask
    ? `${CYAN}${s.currentTask.title}${RESET}  ${DIM}${s.currentTaskId}${RESET}`
    : `${DIM}(none)${RESET}`;
  return `Current task: ${current}\nTotal tasks:  ${s.taskCount}`;
}

export function formatProjects(projects: Project[]): string {
  if (!projects.length) return 'No projects found.';
  return projects
    .map((p) => {
      const archived = p.isArchived ? `${YELLOW} [archived]${RESET}` : '';
      return `${BOLD}${p.title}${RESET}${archived}  ${DIM}${p.id}${RESET}`;
    })
    .join('\n');
}

export function formatTags(tags: Tag[]): string {
  if (!tags.length) return 'No tags found.';
  return tags.map((t) => `${BOLD}${t.title}${RESET}  ${DIM}${t.id}${RESET}`).join('\n');
}
