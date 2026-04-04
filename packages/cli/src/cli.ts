#!/usr/bin/env node

import {
  SuperProductivityClient,
  AppNotRunningError,
  SuperProductivityError,
} from './client';
import { TaskCreateFields, TaskUpdateFields } from './types';
import {
  formatTask,
  formatTaskList,
  formatStatus,
  formatProjects,
  formatTags,
} from './format';
import { parseDuration } from './parse-duration';

const client = new SuperProductivityClient();

function arg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

const isJson = (args: string[]): boolean => hasFlag(args, '--json');

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

const HELP = `Usage: sp <command> [options]

Commands:
  health                          Check if the app is running
  status                          Show current task and task count
  tasks [options]                 List tasks
  task <id>                       Show task details
  add <title> [options]           Create a task
  update <id> [options]           Update a task
  done <id>                       Mark task as done
  delete <id>                     Delete a task
  archive <id>                    Archive a task
  restore <id>                    Restore an archived task
  start <id>                      Start tracking time on a task
  stop                            Stop tracking time
  current                         Show currently tracked task
  projects [options]              List projects
  tags [options]                  List tags

Task list options:
  --query <text>                  Filter by title text
  --project <id>                  Filter by project ID
  --tag <id>                      Filter by tag ID
  --done                          Include completed tasks
  --archived                      Search archived tasks
  --all                           Search all tasks

Task create/update options:
  --project <id>                  Set project
  --tag <id>                      Add tag (can repeat)
  --due <YYYY-MM-DD>              Set due date
  --estimate <duration>           Set time estimate (e.g. 1h30m, 45m)
  --notes <text>                  Set notes
  --title <text>                  Set title (update only)

Global options:
  --json                          Output as JSON
  --help, -h                      Show this help
`;

async function run(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'health': {
      const h = await client.health();
      if (isJson(args)) return printJson(h);
      console.log(`Server: ${h.server}\nRenderer ready: ${h.rendererReady}`);
      break;
    }

    case 'status': {
      const s = await client.status();
      if (isJson(args)) return printJson(s);
      console.log(formatStatus(s));
      break;
    }

    case 'tasks': {
      const source = hasFlag(args, '--archived')
        ? ('archived' as const)
        : hasFlag(args, '--all')
          ? ('all' as const)
          : ('active' as const);
      const tasks = await client.listTasks({
        query: arg(args, '--query'),
        projectId: arg(args, '--project'),
        tagId: arg(args, '--tag'),
        includeDone: hasFlag(args, '--done'),
        source,
      });
      if (isJson(args)) return printJson(tasks);
      console.log(formatTaskList(tasks));
      break;
    }

    case 'task': {
      const id = args[1];
      if (!id) return die('Usage: sp task <id>');
      const t = await client.getTask(id);
      if (isJson(args)) return printJson(t);
      console.log(formatTask(t));
      break;
    }

    case 'add': {
      const title = args[1];
      if (!title) return die('Usage: sp add <title> [options]');
      const fields: TaskCreateFields = {};
      const projectId = arg(args, '--project');
      if (projectId) fields.projectId = projectId;
      const tagId = arg(args, '--tag');
      if (tagId) fields.tagIds = [tagId];
      const due = arg(args, '--due');
      if (due) fields.dueDay = due;
      const notes = arg(args, '--notes');
      if (notes) fields.notes = notes;
      const estimate = arg(args, '--estimate');
      if (estimate) {
        const ms = parseDuration(estimate);
        if (isNaN(ms))
          return die(`Invalid duration: ${estimate}. Use format like 1h30m or 45m`);
        fields.timeEstimate = ms;
      }
      const t = await client.createTask(title, fields);
      if (isJson(args)) return printJson(t);
      console.log(`Created: ${t.title}  ${t.id}`);
      break;
    }

    case 'update': {
      const id = args[1];
      if (!id) return die('Usage: sp update <id> [options]');
      const fields: TaskUpdateFields = {};
      const title = arg(args, '--title');
      if (title) fields.title = title;
      const notes = arg(args, '--notes');
      if (notes) fields.notes = notes;
      const projectId = arg(args, '--project');
      if (projectId) fields.projectId = projectId;
      const tagId = arg(args, '--tag');
      if (tagId) fields.tagIds = [tagId];
      const due = arg(args, '--due');
      if (due) fields.dueDay = due;
      const estimate = arg(args, '--estimate');
      if (estimate) {
        const ms = parseDuration(estimate);
        if (isNaN(ms))
          return die(`Invalid duration: ${estimate}. Use format like 1h30m or 45m`);
        fields.timeEstimate = ms;
      }
      if (hasFlag(args, '--done')) fields.isDone = true;
      if (Object.keys(fields).length === 0) return die('No fields to update');
      const t = await client.updateTask(id, fields);
      if (isJson(args)) return printJson(t);
      console.log(`Updated: ${t.title}  ${t.id}`);
      break;
    }

    case 'done': {
      const id = args[1];
      if (!id) return die('Usage: sp done <id>');
      const t = await client.updateTask(id, { isDone: true });
      if (isJson(args)) return printJson(t);
      console.log(`Completed: ${t.title}`);
      break;
    }

    case 'delete': {
      const id = args[1];
      if (!id) return die('Usage: sp delete <id>');
      await client.deleteTask(id);
      if (isJson(args)) return printJson({ deleted: true, id });
      console.log(`Deleted task ${id}`);
      break;
    }

    case 'archive': {
      const id = args[1];
      if (!id) return die('Usage: sp archive <id>');
      await client.archiveTask(id);
      if (isJson(args)) return printJson({ archived: true, id });
      console.log(`Archived task ${id}`);
      break;
    }

    case 'restore': {
      const id = args[1];
      if (!id) return die('Usage: sp restore <id>');
      const t = await client.restoreTask(id);
      if (isJson(args)) return printJson(t);
      console.log(`Restored: ${t.title}  ${t.id}`);
      break;
    }

    case 'start': {
      const id = args[1];
      if (!id) return die('Usage: sp start <id>');
      await client.startTask(id);
      if (isJson(args)) return printJson({ started: true, taskId: id });
      console.log(`Started tracking: ${id}`);
      break;
    }

    case 'stop': {
      await client.stopTask();
      if (isJson(args)) return printJson({ stopped: true });
      console.log('Stopped tracking.');
      break;
    }

    case 'current': {
      const t = await client.getCurrentTask();
      if (isJson(args)) return printJson(t);
      if (!t) {
        console.log('No task is currently being tracked.');
      } else {
        console.log(formatTask(t));
      }
      break;
    }

    case 'projects': {
      const projects = await client.listProjects(arg(args, '--query'));
      if (isJson(args)) return printJson(projects);
      console.log(formatProjects(projects));
      break;
    }

    case 'tags': {
      const tags = await client.listTags(arg(args, '--query'));
      if (isJson(args)) return printJson(tags);
      console.log(formatTags(tags));
      break;
    }

    default:
      die(`Unknown command: ${command}. Run "sp --help" for usage.`);
  }
}

function die(msg: string): void {
  console.error(msg);
  process.exit(1);
}

run(process.argv).catch((err: unknown) => {
  if (err instanceof AppNotRunningError) {
    console.error(err.message);
    process.exit(2);
  }
  if (err instanceof SuperProductivityError) {
    console.error(`Error [${err.code}]: ${err.message}`);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
