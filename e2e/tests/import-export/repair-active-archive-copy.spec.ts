import type { Page } from '@playwright/test';
import type { AppDataComplete } from '../../../src/app/op-log/model/model-config';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '../../fixtures/test.fixture';
import { ImportPage } from '../../pages/import.page';
import { allowDevErrorsInCurrentTest } from '../../utils/runtime-errors';
import { flushPendingWrites } from '../../utils/waits';

type Backup = { data: AppDataComplete; timestamp: number; crossModelVersion: number };
const exportBackup = async (page: Page): Promise<Backup> => {
  const imex = new ImportPage(page);
  await flushPendingWrites(page);
  await imex.navigateToImportPage();
  const pending = page.waitForEvent('download');
  await imex.exportBackupBtn.click();
  const download = await pending;
  return JSON.parse(readFileSync((await download.path())!, 'utf8')) as Backup;
};

for (const archive of ['archiveYoung', 'archiveOld'] as const) {
  for (const list of ['taskIds', 'backlogTaskIds'] as const) {
    test(`repair keeps the active ${list} task over its ${archive} copy`, async ({
      page,
      workViewPage,
    }, testInfo) => {
      test.setTimeout(120000);
      // The missing tag below is what makes validation fail and run repair.
      allowDevErrorsInCurrentTest(/tagId from task not existing/);
      await workViewPage.waitForTaskList();
      await workViewPage.addTask('Synthetic recovery sentinel 10m/1h');
      const backup = await exportBackup(page);
      const data = backup.data;
      const task = Object.values(data.task.entities).find((t) =>
        t?.title.includes('Synthetic recovery sentinel'),
      )!;
      const id = task.id;
      const project = data.project.entities[task.projectId!]!;
      const current = {
        ...task,
        notes: 'Synthetic current notes',
        deadlineDay: '2030-06-17',
      };
      data.task.entities[id] = { ...current, tagIds: ['SYNTHETIC_MISSING_TAG'] };
      data.project.entities[project.id] = {
        ...project,
        taskIds: list === 'taskIds' ? [id] : [],
        backlogTaskIds: list === 'backlogTaskIds' ? [id] : [],
      };
      data[archive].task = {
        ids: [id],
        entities: {
          [id]: {
            ...task,
            notes: 'Synthetic older notes',
            timeSpent: 0,
            timeSpentOnDay: {},
            isDone: true,
          },
        },
      };
      const path = testInfo.outputPath('synthetic-recovery.json');
      writeFileSync(path, JSON.stringify(backup));
      await new ImportPage(page).importBackupFile(path);
      for (let pass = 0; pass < 2; pass++) {
        if (pass) await page.reload();
        const result = (await exportBackup(page)).data;
        const restored = result.task.entities[id]!;
        expect.soft(restored.notes).toBe(current.notes);
        expect.soft(restored.timeSpent).toBe(current.timeSpent);
        expect.soft(restored.timeSpentOnDay).toEqual(current.timeSpentOnDay);
        expect.soft(restored.deadlineDay).toBe(current.deadlineDay);
        expect.soft(restored.isDone).toBe(current.isDone);
        expect.soft(result.task.ids.filter((t) => t === id)).toHaveLength(1);
        expect(result.archiveYoung.task.entities[id]).toBeUndefined();
        expect(result.archiveOld.task.entities[id]).toBeUndefined();
        expect(result.project.entities[project.id]![list]).toContain(id);
      }
    });
  }
}
