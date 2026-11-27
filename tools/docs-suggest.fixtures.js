/**
 * Real Q&A discussion titles (and the opening of their body) from
 * super-productivity/super-productivity, with the docs pages a human judged correct.
 *
 * - `ok`: pages that would be a correct link (path under /docs/). Anything else is a wrong link.
 * - `expect`: 'hit' = a page clearly answers it;
 *   'silent' = no page answers it, nothing may be posted;
 *   'either' = a correct link or silence are both fine.
 *
 * The shortlist recall floor in docs-suggest.test.js counts every fixture with a non-empty `ok`.
 *
 * Judged by reading the docs, not by running the matcher. Do not edit `ok`/`expect` to make
 * the matcher pass.
 */
const FIXTURES = [
  {
    n: 9965,
    title: 'Restoring from backup. My work has been lost.',
    body: 'Is there a way to restore from backup? My set up with SP has disappeared. I have been using a custom board that I set up with a good flow that was working great for two weeks, but now the board is gone',
    ok: ['how-to/restore-data-from-backup', 'explanation/managing-your-data'],
    expect: 'hit',
  },
  {
    n: 10373,
    title: 'Why is "Inbox" a Project?',
    body: 'It is all in the title, but here is the context. Areas of work and projects. I use Superproductivity Projects to track the time I spend in areas of work.',
    ok: ['explanation/inbox-view', 'explanation/project-view'],
    expect: 'hit',
  },
  {
    n: 9343,
    title: 'Disable time detection for tasks?',
    body: 'I work in construction and use "m" for meters in tasks. It always autodetects it as the minutes for the task and removes it from the task. Can I disable that? example: "4x 5m" = "4x" 5 minutes',
    ok: [
      'reference/short-syntax',
      'reference/settings-and-preferences',
      'how-to/add-tasks',
    ],
    expect: 'hit',
  },
  {
    n: 11539,
    title: "Can't turn off idle tracking?",
    body: 'I don\'t need the idle timer, but clicking the "don\'t track" button on the "what were you doing?" dialog doesn\'t turn the feature off. Is there a different option I should be looking for?',
    ok: ['explanation/idle-time', 'reference/settings-and-preferences'],
    expect: 'hit',
  },
  {
    n: 9552,
    title: 'Worklog Export "Titles and Subtask Titles"',
    body: 'Hi there I got a little issue with the workload export. If I export it like that I get',
    ok: ['explanation/worklog'],
    expect: 'hit',
  },
  {
    n: 10313,
    title: 'Recurring task advanced settings',
    body: "Can anyone please explain the interaction between these 2 recurring task advanced settings? 1. Only create next task after completion 2. Don't let overdue instances pile up",
    ok: ['explanation/repeating-tasks', 'how-to/manage-repeating-tasks'],
    expect: 'hit',
  },
  {
    n: 11666,
    title: 'No local backup setting available, only Sync',
    body: 'I thought I was installing something that would keep everything local to my computer (work requirement). Have been using for a couple weeks. Wanted to back up but only see ability to "sync".',
    ok: [
      'explanation/managing-your-data',
      'reference/user-data',
      'how-to/restore-data-from-backup',
    ],
    expect: 'hit',
  },
  {
    n: 10041,
    title:
      'Time Tracking: Is it possible to get reports from time tracking (or CSV export) and show & edit tracked times?',
    body: 'I just found super-productivity while searching for an alternative to Clockify. I like the idea that it combines time tracking with task management! One thing I did not find yet is if and how I can get reports',
    ok: ['explanation/worklog', 'explanation/how-time-is-logged', 'explanation/metrics'],
    expect: 'hit',
  },
  {
    n: 11902,
    title: 'Mass Unarchive All Archived Tasks',
    body: "I'm using the flatpak version of super productivity. I have a bunch of archived tasks, and simply want to unarchive all of them. There doesn't seem to be a way to actually mass unarchive all the tasks through the GUI",
    ok: ['explanation/task-archiving'],
    expect: 'hit',
  },
  {
    n: 11933,
    title: 'Is there a way to adjust the font size/style',
    body: 'Hello, I just installed super-productivity for desktop and app. Everything looks good but I wanted to know if there is a way to adjust the text font/size within the app? Is that available or is there a plug-in?',
    ok: ['reference/theming'],
    expect: 'either',
  },
  {
    n: 9339,
    title: 'Any reason not to enable compression?',
    body: 'I noticed this "Enable compression (faster data transfer)" option in sync settings. It sounds nice but is there any reason I shouldn\'t enable compression?',
    ok: ['how-to/configure-sync-backend'],
    expect: 'either',
  },
  {
    n: 10476,
    title:
      'Is there a way to stop switching windows focus after a Pomodoro or a Break timer end?',
    body: 'Whenever a pomodoro or its break timer end, focus gets taken away from the window I am working on and the Super Productivity window comes forward. This is annoying and unnecessary for me.',
    ok: [
      'explanation/timers-and-focus-mode',
      'explanation/break-reminders',
      'reference/settings-and-preferences',
    ],
    expect: 'either',
  },
  {
    n: 11785,
    title: 'Sync sign in problem',
    body: 'I was able to sign in on PC just fine, but when I tried to sign in on my phone it said there was a problem with the connection. However, even when I changed the internet it still had the same problem',
    ok: ['how-to/configure-sync-backend', 'tutorials/configure-data-synchronization'],
    expect: 'either',
  },
  {
    n: 11737,
    title: 'How to set up projects/tasks',
    body: 'I am a writer and I basically want: 1. to be reminded periodically to write for one project (that is personal project, I guess they will all live inside the SP Project WRITE, but it can be done differently if necessary)',
    ok: [
      'explanation/project-view',
      'how-to/manage-repeating-tasks',
      'how-to/add-tasks',
      'tutorials/first-steps',
    ],
    expect: 'either',
  },
  {
    n: 11361,
    title: 'How to deal with big Task Backlog & how to Plan entire projects?',
    body: 'I am still getting the hang of the super productivity app and I have been using it for a few months now. It is really useful. But I have problem with it. I have a backlog of more than 30 tasks and more subtasks',
    ok: ['explanation/planner-view', 'explanation/project-view', 'how-to/add-tasks'],
    expect: 'either',
  },
  {
    n: 10588,
    title: 'During creation, Add task to specific section of a project?',
    body: "I wasn't able to find anything about this in a guide and wondering if it's possible? Like the title says, is there any shortcut to type in which section of a project I want the task added to?",
    ok: ['reference/short-syntax', 'how-to/add-tasks'],
    expect: 'either',
  },
  {
    n: 10562,
    title: 'How do I retain schedule history?',
    body: "In the Schedule view, it doesn't seem to show old tasks I completed a week ago, let alone a few days ago. I can search in the archives but I want to have a sort of Calendar birds eye view of what I did",
    ok: ['explanation/worklog', 'explanation/schedule-view'],
    expect: 'either',
  },
  {
    n: 10371,
    title: 'ist there a Bord that shows tomorrow exakly the way like the today-bord?',
    body: 'Hey there, first thanks to all developers for this verry nice tool. Now to the actual question: Is there a way to display the next day as a board with its corresponding timeline',
    ok: [
      'explanation/planner-view',
      'explanation/board-view',
      'explanation/the-today-view',
    ],
    expect: 'either',
  },
  {
    n: 10117,
    title: 'How to best handle scheduled tasks that cannot be completed right now?',
    body: 'I have a situation that, likely, is fairly common. I have some recurring tasks that were scheduled to be started a week ago. Due to factors outside my control, they cannot be started yet.',
    ok: [
      'explanation/scheduled-tasks',
      'how-to/manage-scheduled-tasks',
      'explanation/repeating-tasks',
      'how-to/manage-repeating-tasks',
    ],
    expect: 'either',
  },
  {
    n: 10014,
    title: '[iOS] CloudKit sync or file based iCloud Drive sync',
    body: 'Not seeing either option. Could this be implemented?',
    ok: [
      'how-to/choose-sync-backend',
      'reference/sync-integration-comparison',
      'how-to/configure-sync-backend',
    ],
    expect: 'either',
  },
  {
    n: 9949,
    title:
      'Falsely displaying whole-day-appointments from calender (via CALDAV) one day ahead of date',
    body: 'I just connected my calendar (nextcloud) via caldav to superproductivity on windows 11, after already working with the task integration in SP via caldav with the same calendar',
    ok: ['how-to/set-up-caldav'],
    expect: 'either',
  },
  {
    n: 9649,
    title: 'Update a handful of tasks?',
    body: 'Can we really not select a handful of tasks and collectively assign them a new due date? Or am I doing something wrong? Currently I have to manually repeat 4 steps for, say 10 tasks, to schedule that set to a new date.',
    ok: ['explanation/planner-view', 'how-to/manage-scheduled-tasks'],
    expect: 'either',
  },
  {
    n: 9638,
    title: 'Tracking weekly hours.',
    body: 'Hello, I would like to work 20 hours per week on my project, but I got a little trouble setting that up. The way it tracks it now, is that it tracks 20 hours per day for one week.',
    ok: ['explanation/time-estimates'],
    expect: 'either',
  },
  {
    n: 9346,
    title: 'Is there no sound implemented for task reminders (in the web app version)?',
    body: "I can hear a sound on task completion but there's nothing when a reminder pops e.g. for a task that's scheduled to start, the reminder pops up visually (if I'm in the SP tab in the browser)",
    ok: ['reference/web-app-vs-desktop', 'reference/settings-and-preferences'],
    expect: 'either',
  },
  {
    n: 12020,
    title:
      "Can I stop the task reminders screen from covering the app's window every single time I return to the app after a while away?",
    body: "It's useful I'm sure, for those who absolutely can't get behind for any task. But I'm content with just seeing missed tasks left in the list, as well as notifications when they are due.",
    ok: ['reference/settings-and-preferences', 'how-to/manage-scheduled-tasks'],
    expect: 'either',
  },
  {
    n: 12040,
    title:
      "I tapped the check mark on a task in the modal reminders popup over the top of the app, and it deleted the time for that event's reminder.",
    body: "Is this a bug? Or a feature I do not understand? Cause why on earth would I want a repeating task's reminder time to be deleted when I tap the check mark next to it in the reminders popup",
    ok: ['how-to/manage-repeating-tasks', 'explanation/repeating-tasks'],
    expect: 'either',
  },
  {
    n: 9865,
    title: 'SuperSync signup emails not being received',
    body: 'Trying to sign up for SuperSync. Have tried three different email addresses, no verification/magic link email received. Checked the usual hiding places like Junk. Any known issues with the outgoing mail server?',
    ok: ['how-to/configure-sync-backend'],
    expect: 'either',
  },
  {
    n: 10837,
    title: 'Flathub version out of date',
    body: "The latest version on Flathub is still v19.1.0, not v19.2.0. I'd wait it out but at least the previous release dropped the same day on Github and Flathub, so I'm not sure if this is expected.",
    ok: ['how-to/downloads-and-install'],
    expect: 'either',
  },
  {
    n: 10105,
    title: 'I have a very silly question to ask.',
    body: 'At this moment, if the total number of open issues is 1,333 and the number of closed issues is 3,994, then how have the issue numbers crossed 10K+? then Where are the remaining issues?',
    ok: [],
    expect: 'silent',
  },
  {
    n: 9942,
    title: 'Copy & Paste',
    body: 'Why is my right cliker on my mouse not working? Its not allowing me to copy and paste. With my dislectia going between two windows just to get one word spelled corretly is a problem',
    ok: [],
    expect: 'silent',
  },
  {
    n: 9699,
    title: 'Version tags without Github release',
    body: 'Hi, Arch maintainer here. There is a tag for v18.20.1, but neither a GitHub release nor a release on Flathub. We usually track package versions by git tags',
    ok: [],
    expect: 'silent',
  },
  {
    n: 9676,
    title: 'Keep the AUR Package?',
    body: "Congrats on the success of your app on the ArchLinux world. It has become so popular it's now being released by an official Arch Package Maintainer!",
    ok: ['how-to/downloads-and-install'],
    expect: 'either',
  },
  {
    n: 10806,
    title: 'iOS app keep showing: Could not import shared content.',
    body: 'Keep showing this message every time I open the app. How to fix it? Is it because I share something to the app and it could not handle it?',
    ok: [],
    expect: 'silent',
  },
  {
    n: 11992,
    title:
      'Two-way sync: are edits that arrive via sync from another device meant to be pushed to the provider?',
    body: "I'm using SP 20.1.0 on macOS and iOS, synced via WebDAV. I built a Todoist issue provider plugin myself, which implements updateIssue",
    // the plugin guide is a contributing page, which suggestions never link
    ok: ['reference/api'],
    expect: 'either',
  },
  {
    n: 11535,
    title: 'Android Widget Help - Always stay on "Today" and task syncing?',
    body: 'Hey, love using SuperProductivity and am working to incorporate it into more parts of my life now that Google Assistant/Task Reminders are junk. Right now, I keep the widget on the home page of my phone',
    ok: [],
    expect: 'silent',
  },
];

module.exports = { FIXTURES };
