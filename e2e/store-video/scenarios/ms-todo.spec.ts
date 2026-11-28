/**
 * Microsoft To Do migration reel (`REEL_VARIANT=ms-todo`): open the importer
 * from Settings, sign in, review the preview, import, then land on an imported
 * list and in Today. Microsoft is faked as in the E2E import test, so the reel
 * shows realistic lists without a real account, and the sign-in popup is
 * never on screen.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixture';
import { hold } from '../helpers';
import { fakeMicrosoftTodo } from '../../helpers/fake-microsoft-todo';
import { ImportPage } from '../../pages/import.page';
import { SCREENSHOT_BASE_DATE } from '../../store-screenshots/matrix';
import {
  createCamera,
  createPointer,
  type LayerHandle,
  loopBoundary,
  markScene,
  nextScene,
  showEndCard,
} from '../../video-kit';

/** Raw Graph due date `offsetDays` after the seed's pinned "today". */
const due = (offsetDays: number): { dateTime: string; timeZone: string } => {
  const day = new Date(SCREENSHOT_BASE_DATE);
  day.setDate(day.getDate() + offsetDays);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const ymd = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return { dateTime: `${ymd}T00:00:00.0000000`, timeZone: 'UTC' };
};
const weekly = (day: string): object => ({
  pattern: { type: 'weekly', interval: 1, daysOfWeek: [day] },
  range: { type: 'noEnd' },
});

const LISTS = [
  { id: 'L-tasks', displayName: 'Tasks', wellknownListName: 'defaultList' },
  { id: 'L-home', displayName: 'Home', wellknownListName: 'none' },
  { id: 'L-groceries', displayName: 'Groceries', wellknownListName: 'none' },
  { id: 'L-flagged', displayName: 'Flagged email', wellknownListName: 'flaggedEmails' },
];

const TASKS: Record<string, unknown[]> = {
  ['L-tasks']: [
    {
      id: 'T-passport',
      title: 'Renew passport',
      dueDateTime: due(14),
      isReminderOn: true,
    },
    { id: 'T-bank', title: 'Call the bank about the card' },
  ],
  ['L-home']: [
    {
      id: 'T-bike',
      title: 'Fix the bike light',
      dueDateTime: due(0),
      body: { content: '<p>Front light flickers.</p>', contentType: 'html' },
      checklistItems: [
        { id: 's-battery', displayName: 'Buy a new battery', isChecked: true },
        { id: 's-bulb', displayName: 'Replace the bulb', isChecked: false },
      ],
    },
    {
      id: 'T-dentist',
      title: 'Book the dentist',
      importance: 'high',
      dueDateTime: due(2),
    },
    {
      id: 'T-plants',
      title: 'Water the plants',
      dueDateTime: due(4),
      recurrence: weekly('sunday'),
    },
  ],
  ['L-groceries']: [
    {
      id: 'T-shop',
      title: 'Weekly shop',
      categories: ['errand'],
      dueDateTime: due(3),
      recurrence: weekly('saturday'),
      checklistItems: [
        { id: 's-milk', displayName: 'Milk', isChecked: false },
        { id: 's-coffee', displayName: 'Coffee beans', isChecked: false },
        { id: 's-bread', displayName: 'Bread', isChecked: true },
      ],
    },
  ],
  ['L-flagged']: [{ id: 'T-invoice', title: 'Re: Invoice 2231' }],
};

/** Imported project ids are generated, so look the project up by title. */
const projectIdByTitle = async (page: Page, title: string): Promise<string> => {
  const id = await page.evaluate((projectTitle) => {
    type Root = { projects: { entities: Record<string, { id: string; title: string }> } };
    const { store } = (
      window as unknown as {
        __e2eTestHelpers: {
          store: { subscribe: (fn: (s: Root) => void) => { unsubscribe: () => void } };
        };
      }
    ).__e2eTestHelpers;
    let found: string | undefined;
    store
      .subscribe((state) => {
        found = Object.values(state.projects.entities).find(
          (p) => p.title === projectTitle,
        )?.id;
      })
      .unsubscribe();
    return found;
  }, title);
  if (!id) throw new Error(`No project titled ${title}`);
  return id;
};

test.describe('@video Microsoft To Do migration reel', () => {
  test.skip(process.env.REEL_VARIANT !== 'ms-todo', 'requires REEL_VARIANT=ms-todo');
  test.use({ locale: 'en', theme: 'dark' });

  test('move from Microsoft To Do', async ({ seededPage: page, markBeatsStart }) => {
    await fakeMicrosoftTodo(page.context(), LISTS, TASKS);
    const pointer = createPointer(page);
    const camera = createCamera(page, 'app-root');
    const frame = page.frameLocator('plugin-index iframe');
    await page.clock.resume();
    await page.goto('/#/tag/TODAY/tasks');
    await expect(page.locator('task').first()).toBeVisible();
    await pointer.park();

    const intro = await showEndCard(page, {
      title: 'Leaving Microsoft To Do?',
      subtitle: 'Bring your lists with you.',
      logo: { src: '/assets/icons/sp.svg', monochrome: true },
    });
    await loopBoundary(page, 'out', 0);
    markBeatsStart();
    await hold(200);
    await loopBoundary(page, 'in', 450);
    await hold(2200);

    const openImporter = page.locator('file-imex button', {
      hasText: 'Import from Microsoft To Do',
    });
    let caption: LayerHandle | undefined = await nextScene(page, {
      caption: 'One button in Settings.',
      pointer,
      setup: async () => {
        await intro.hide();
        await new ImportPage(page).navigateToImportPage();
        await openImporter.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      },
    });
    await pointer.glideTo(openImporter);
    await hold(300);
    await openImporter.click();
    const signIn = frame.getByRole('button', { name: 'Sign in with Microsoft' });
    await expect(signIn).toBeVisible();
    await pointer.park();
    await hold(900);

    caption = await nextScene(page, {
      caption: 'Sign in. Read-only access.',
      pointer,
    });
    await pointer.glideTo(signIn);
    await hold(300);
    await signIn.click();
    await expect(frame.getByText('Home — tasks: 3, steps: 2')).toBeVisible();
    await pointer.park();
    await hold(600);

    caption = await nextScene(page, {
      caption: 'See what won’t carry over.',
      pointer,
    });
    const lists = frame.locator('label').filter({ hasText: /tasks: \d+, steps: \d+/ });
    await expect(lists).toHaveCount(4);
    const reminderLoss = frame.getByText('Reminders not imported: 1.');
    await expect(reminderLoss).toBeVisible();
    await camera.zoomTo([lists.first(), reminderLoss], { scale: 1.6, durationMs: 700 });
    await hold(3200);
    await camera.reset({ durationMs: 500 });
    const importBtn = frame.getByRole('button', { name: 'Import', exact: true });
    await importBtn.scrollIntoViewIfNeeded();
    await pointer.glideTo(importBtn);
    await hold(300);
    await importBtn.click();
    await expect(frame.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(frame.getByText('Home: 3 of 3 tasks, 2 of 2 steps')).toBeVisible();
    await pointer.park();
    await hold(1800);

    caption = await nextScene(page, {
      caption: 'Lists become projects.',
      pointer,
      camera,
      setup: async () => {
        await page.goto(`/#/project/${await projectIdByTitle(page, 'Home')}/tasks`);
        await expect(
          page.locator('task', { hasText: 'Replace the bulb' }).last(),
        ).toBeVisible();
      },
    });
    await hold(800);
    const bike = page.locator('task', { hasText: 'Fix the bike light' }).first();
    await camera.zoomTo(bike, { scale: 1.2, durationMs: 700 });
    await hold(2200);
    await camera.reset({ durationMs: 500 });
    await expect(
      page
        .locator('task', { hasText: 'Water the plants' })
        .first()
        .locator('tag-list mat-icon', { hasText: 'repeat' }),
    ).toBeVisible();
    await hold(1500);

    caption = await nextScene(page, {
      caption: 'Due today? It’s in Today.',
      pointer,
      camera,
      setup: async () => {
        await page.goto('/#/tag/TODAY/tasks');
        await expect(
          page.locator('task', { hasText: 'Fix the bike light' }).first(),
        ).toBeVisible();
      },
    });
    await hold(800);
    await camera.zoomTo(page.locator('task', { hasText: 'Fix the bike light' }).first(), {
      scale: 1.2,
      durationMs: 700,
    });
    await hold(2000);
    await camera.reset({ durationMs: 500 });

    markScene(page, 'Your tasks. Your device.');
    await showEndCard(page, {
      title: 'Your tasks. Your device.',
      subtitle: 'Super Productivity',
      stats: ['Free · Open source · Works offline', 'superproductivity.com'],
      logo: { src: '/assets/icons/sp.svg', monochrome: true },
    });
    void caption?.hide();
    await hold(3000);
    await loopBoundary(page, 'out', 350);
  });
});
