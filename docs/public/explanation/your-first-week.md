---
title: Your first week with Super Productivity
type: explanation
domain: super-productivity
---

# Your first week with Super Productivity

> **Explanation**: Explores how Super Productivity organizes tasks: where a task lives, which views show it,
> what its dates mean, and which features you can leave switched off.

In the first week the same task shows up in several places, and a place you expect to find it in stays empty.
One rule explains both: a task lives in exactly one project, and Today, the Planner, and the Schedule are views that pick tasks by date.
The rest of this page follows a task from the moment you add it to the moment you archive it.

## A task lives in one project

Every task belongs to exactly one project.[^task-model]
The Inbox is a project that the app creates for you, and it holds every task that you have not put anywhere else.[^inbox]

Where a new task goes depends on the view you add it from:[^new-task-project]

- In a project, the task goes into that project.
- Anywhere else, such as Today, the task goes into the default project.
  The default project is the Inbox until you change **Default project to use for tasks if none is specified** under **Settings → Tasks**.

This is why the Inbox does not list the tasks of your other projects: the Inbox shows its own tasks only.[^inbox-list]
A task "without a project" is a task in the Inbox.
You cannot delete or archive the Inbox.[^inbox-protected]

A tag is a label.
A task carries any number of tags, and a tag view lists the tasks that carry it, across all projects.[^task-model]

|               | Project                                    | Tag                                    |
| ------------- | ------------------------------------------ | -------------------------------------- |
| A task has    | Exactly one                                | None, one, or several                  |
| A new subtask | Takes the project of its parent            | Starts without tags                    |
| Good for      | A list that owns its tasks, such as a trip | A label across lists, such as `errand` |
| Grouped by    | Folders in the side menu                   | Folders in the side menu               |

The app has no "area" level above projects.
To keep work and private tasks apart, group projects into folders: see [Separate work and private tasks](../how-to/separate-work-and-private-tasks.md).
[Projects vs tags](https://super-productivity.com/docs/explanation/project-view/#projects-vs-tags) covers the comparison in more depth.

## Today, the Planner, and the Schedule are views by date

Today is not a container.
It lists every task planned for today, from every project, and a task in Today is still in its project.[^today]
Removing a task from Today clears its date and leaves the task in its project.

| View     | Shows                                              | Answers                     | New install |
| -------- | -------------------------------------------------- | --------------------------- | ----------- |
| Today    | Tasks planned for today, from all projects         | What do I work on now?      | On          |
| Inbox    | Tasks in the Inbox project, with or without a date | What have I not sorted yet? | On          |
| Planner  | The coming days, each with its planned tasks       | Which day do I do it?       | On          |
| Schedule | A time grid by day, week, or month                 | At what time does it fit?   | Off         |

A task planned for an earlier day and not done moves to **From previous days** at the top of Today.[^overdue]
[Today, Planner and Schedule compared](https://super-productivity.com/docs/explanation/planner-view/#today-planner-and-schedule-compared) describes the three views side by side.

## A task has a planned date and can have a deadline

The app keeps two questions apart: when you intend to work on a task, and when it must be finished.

| Date           | Question                   | Effect                                                      |
| -------------- | -------------------------- | ----------------------------------------------------------- |
| Planned day    | Which day do I work on it? | The task appears in Today on that day and in the Planner.   |
| Scheduled time | At what time?              | The same, plus a fixed slot in the Schedule and a reminder. |
| Deadline       | When must it be finished?  | The task stays where you planned it until the deadline day. |

A planned date is either a day or a time, never both.[^task-dates]
The task details name it **Planned for**, next to a separate deadline item.[^detail-labels]

A deadline does not put a task into Today before its day.
On the deadline day, an unfinished task with no planned date, or with a planned date in the past, moves into Today.
A task that you planned for a later day stays on that day.[^deadline-auto-plan]

[Deadline vs. schedule](https://super-productivity.com/docs/how-to/add-tasks/#deadline-vs-schedule) lists the buttons and shortcuts for each date.

## A project backlog stays closed until you open it

A project can have a backlog: a second list for tasks you are not working on yet.
The backlog is off for a new project, so most first-week setups never meet it.[^backlog-default]

With **Enable Project Backlog** switched on in the project's settings, a backlog button with a task counter appears below the task list.[^backlog-handle]
Click that button, or press `B`, to open and close the backlog.[^backlog-toggle]
A closed backlog shows only the counter, which is why tasks in it are hard to spot.

The backlog changes where a task sits in its project, not its date.
A backlog task planned for today still appears in Today.[^today]

## Done tasks stay until you archive them

Marking a task done moves it to **Completed Tasks** at the bottom of the same list.
It stays there until you archive it.

Below the completed tasks, **Move completed tasks to archive** archives the done tasks of that list.[^archive-button]
The **Finish day** feature replaces that button in Today with **Finish Day**, which opens a summary of the day and then archives the done tasks.
**Finish day** is off on a new install.[^new-install]

Archived tasks leave the lists and stay in your data.
To find one, open the ⋮ menu in the header of Today, a project, or a tag and choose **History**, or use **Search**, which includes archived tasks.[^history-menu]
[Task archiving](https://super-productivity.com/docs/explanation/task-archiving/) explains what the archive keeps.

## A task opens in two ways

A task has a details panel and a menu, and each opens with a different gesture.[^task-open]

| To                                       | With mouse and keyboard                       | On a touch screen |
| ---------------------------------------- | --------------------------------------------- | ----------------- |
| Rename the task                          | Click the title                               | Open the details  |
| Open the details: notes, subtasks, dates | Hover and click **Show/hide task panel**, `I` | Tap the task      |
| Open the menu: plan, tag, move, delete   | Right-click the task, `Q`                     | Swipe left        |
| Mark the task done                       | Click the circle, `D`                         | Swipe right       |

The menu holds quick actions on the task.
The details panel holds what belongs to the task: notes, subtasks, attachments, the planned date, the deadline, and the tracked time.
With a mouse, clicking the title edits it and clicking the rest of the row focuses the task, so that the single-key shortcuts apply to it.

## Several features start switched off

A new install starts with tasks, the Planner, and time tracking.
The Schedule, saved views, habits, focus mode, the **Finish day** button, and the issues panel are off until you switch them on, and break reminders are off as well.[^new-install]
An install that already holds data keeps its own settings.

Time tracking is on, and it records time only for the task you start with the play button.
If you do not track time, switch it off: the play buttons disappear, and your tasks stay as they are.

[Turn off features you do not need](../how-to/turn-off-features-you-do-not-need.md) lists each switch and what it hides.

## Sync is optional

Your data stays on the device, and sync is off until you set it up.[^sync-default]
One device needs no sync at all.
For a second device, [Choose a sync backend](https://super-productivity.com/docs/how-to/choose-sync-backend/) compares the options.

## What this means for your first week

The smallest setup that holds your tasks is enough for the first week, and a feature earns its place when you miss it.
A task added from Today is planned for today and lands in the default project.
A task added in the Inbox itself has no date until you plan it, so the Inbox is where unsorted tasks wait.
A project pays off once a group of tasks deserves its own list, and archiving pays off once a list gets long.

Three worked setups show the steps:

- Everyday lists: [Set up personal to-do lists](../how-to/set-up-personal-to-do-lists.md) covers a shopping list, chores, and a study plan.
- Two parts of life: [Separate work and private tasks](../how-to/separate-work-and-private-tasks.md) covers folders, tags, and one Today.
- A day by the hour: [Time-block your day](../how-to/time-block-your-day.md) covers estimates and the Schedule.

Inside the app, **Help → Quick tour** walks through the same basics on your own task list.

## Related

- [Turn off features you do not need](../how-to/turn-off-features-you-do-not-need.md) — the switches behind **App Features**
- [First steps](https://super-productivity.com/docs/tutorials/first-steps/) — the guided start
- [The Today view](https://super-productivity.com/docs/explanation/the-today-view/) — Today in depth
- [Inbox view](https://super-productivity.com/docs/explanation/inbox-view/) — the Inbox in depth

[^task-model]: `src/app/features/tasks/task.model.ts:L100-L243` — a task has one `projectId` and a list of `tagIds`.

[^inbox]: `src/app/features/project/project.const.ts:L26-L39` — the Inbox is a project with a fixed ID.

[^new-task-project]: `src/app/features/tasks/task.service.ts:L1140-L1146` — the project a new task gets.

[^inbox-list]: `src/app/features/work-context/store/work-context.selectors.ts:L210-L216` — a project view lists its own task IDs.

[^inbox-protected]: `src/app/core-ui/work-context-menu/work-context-menu.component.html:L114-L153` — no delete or archive entry for the Inbox.

[^today]: `src/app/features/work-context/store/work-context.selectors.ts:L42-L81` — Today membership comes from the planned date.

[^overdue]: `src/app/features/tasks/util/is-task-overdue.ts:L31-L43` — when a planned task counts as overdue.

[^task-dates]: `src/app/features/tasks/task.model.ts:L117-L172` — the planned and deadline fields and their exclusions.

[^detail-labels]: `src/app/features/tasks/task-detail-panel/task-detail-panel.component.ts:L420-L438` — the labels of the date items.

[^deadline-auto-plan]: `src/app/features/tasks/util/get-deadline-auto-plan-fields.ts:L63-L77` — the policy for a deadline that is today.

[^backlog-default]: `src/app/features/project/project.const.ts:L11-L18` — a new project has no backlog.

[^backlog-handle]: `src/app/features/work-view/split/split.component.html:L1-L20` — the backlog button and its counter.

[^backlog-toggle]: `src/app/features/work-view/split/split.component.ts:L67-L118` — a click toggles the backlog, a drag resizes it.

[^archive-button]: `src/app/features/work-view/work-view.component.html:L474-L492` — the archive button, which Today hides while **Finish day** is on.

[^new-install]: `src/app/features/config/new-install-config.const.ts:L16-L37` — the features a new install starts without.

[^history-menu]: `src/app/core-ui/work-context-menu/work-context-menu.component.html:L18-L25` — the **History** entry of the header menu.

[^task-open]: `src/app/features/tasks/task/task.component.ts:L1367-L1379` — what a click or tap on a task row does.

[^sync-default]: `src/app/features/config/default-global-config.const.ts:L244-L253` — sync is disabled by default.
