import { test, expect, type Page } from '../../fixtures/test.fixture';

/**
 * End-to-end cover for the crash-safe note draft lifecycle (#8982), in a real
 * running app.
 *
 * The unit suite guards the decision logic against a mocked draft store; this
 * shows the pieces are wired together: that the editor really checkpoints while
 * you type, that the drafts really land in localStorage, and that reopening a
 * note really consults them.
 *
 * The first sequence is the historical defect of this feature. Discard is
 * reachable with NO confirmation dialog, because the editor only confirms when
 * its content differs from what it opened with. So typing, letting the debounce
 * checkpoint, undoing back to the original text and hitting Discard closes
 * instantly while the stored draft still holds the typed text. If the discard
 * fails to remove that draft, the next open silently restores it and the
 * following save writes it over the note.
 */

interface StoredDraft {
  content: string;
  baseContent: string;
}

const DRAFT_KEY_PREFIX = 'SUP_LOCAL_DRAFT_';

/** Reads the device-local drafts from the page's localStorage. */
const readDrafts = (page: Page, prefix: string): Promise<StoredDraft[]> =>
  page.evaluate(
    (draftPrefix: string) =>
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith(draftPrefix))
        .map(([, value]) => {
          try {
            return JSON.parse(value);
          } catch (e) {
            return null;
          }
        })
        .filter((d) => !!d)
        .map((d) => ({ content: d.content, baseContent: d.baseContent })),
    prefix,
  );

test.describe('Note draft discard recovery (#8982)', () => {
  test('a discard after an undo does not resurrect the typed text', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const original = `${testPrefix}-original note body`;
    const typed = `${original} PLUS UNSAVED JUNK`;
    await notePage.addNote(original);
    expect(await notePage.noteExists(original)).toBe(true);

    // --- Open the note and type, so the debounce checkpoints a draft ----------
    const note = notePage.getNoteByContent(original);
    await note.locator('.markdown-preview').click();
    await notePage.noteDialog.waitFor({ state: 'visible' });

    const textarea = page.locator('dialog-fullscreen-markdown textarea').first();
    await textarea.waitFor({ state: 'visible' });
    await textarea.fill(typed);

    // Wait on the checkpoint itself rather than on a timer: the debounce is an
    // implementation detail, the stored draft is the thing the next step needs.
    await expect
      .poll(
        async () => (await readDrafts(page, DRAFT_KEY_PREFIX)).map((d) => d.content),
        {
          message: 'the editor should checkpoint the typed text into localStorage',
        },
      )
      .toContain(typed);

    // --- Undo back to the original, then Discard ------------------------------
    // Content now equals what the editor opened with, so Discard closes with no
    // confirmation and the pending debounce never becomes a second checkpoint.
    await textarea.fill(original);
    await page.locator('#T-close-note, button:has-text("Discard")').first().click();
    await notePage.noteDialog.waitFor({ state: 'hidden' });

    // The stored draft must be gone. Asserted on the store because the damage
    // happens here, one open before the user can see it.
    await expect
      .poll(
        async () => {
          const drafts = await readDrafts(page, DRAFT_KEY_PREFIX);
          return drafts.filter((d) => d.content === typed).length;
        },
        { message: 'the discarded text must not remain as a restorable draft' },
      )
      .toBe(0);

    // --- Reopen: the editor must NOT be seeded with the discarded text --------
    await note.locator('.markdown-preview').click();
    await notePage.noteDialog.waitFor({ state: 'visible' });
    await expect(textarea).toHaveValue(original);

    // --- Escape is the save path, so a bad seed would be written back ---------
    await page.keyboard.press('Escape');
    await notePage.noteDialog.waitFor({ state: 'hidden' });

    expect(await notePage.noteExists(original)).toBe(true);
    expect(await notePage.noteExists(typed, 3000)).toBe(false);
  });

  test('a crash-style close keeps the typed text recoverable', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    // The mirror property, and the reason drafts may not be removed more
    // eagerly: text that was neither saved nor discarded must survive and be
    // offered back. A reload with the editor open is the closest honest
    // stand-in for the crash this feature exists for.
    await workViewPage.waitForTaskList();

    const original = `${testPrefix}-note that will crash`;
    const typed = `${original} RECOVER ME`;
    await notePage.addNote(original);

    const note = notePage.getNoteByContent(original);
    await note.locator('.markdown-preview').click();
    await notePage.noteDialog.waitFor({ state: 'visible' });
    const textarea = page.locator('dialog-fullscreen-markdown textarea').first();
    await textarea.waitFor({ state: 'visible' });
    await textarea.fill(typed);

    await expect
      .poll(async () => (await readDrafts(page, DRAFT_KEY_PREFIX)).map((d) => d.content))
      .toContain(typed);

    // Reload with the edit still open: no save, no discard, nothing removed.
    await page.reload();
    await workViewPage.waitForTaskList();

    // The note itself never changed...
    expect(await notePage.noteExists(original)).toBe(true);
    // ...and reopening offers the unsaved text back for recovery.
    const noteAfterReload = notePage.getNoteByContent(original);
    await noteAfterReload.locator('.markdown-preview').click();
    await notePage.noteDialog.waitFor({ state: 'visible' });
    await expect(page.locator('dialog-fullscreen-markdown textarea').first()).toHaveValue(
      typed,
    );
  });
});
