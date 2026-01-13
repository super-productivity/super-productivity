import { test, expect } from '../../fixtures/test.fixture';

test.describe('Notes CRUD Operations', () => {
  test('should create a new note', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    const noteContent = `${testPrefix}-Test Note Content`;
    await notePage.addNote(noteContent);

    // Verify note exists
    const noteExists = await notePage.noteExists(noteContent);
    expect(noteExists).toBe(true);
  });

  test('should edit an existing note', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a note
    const originalContent = `${testPrefix}-Original Note`;
    await notePage.addNote(originalContent);

    // Verify note exists
    let noteExists = await notePage.noteExists(originalContent);
    expect(noteExists).toBe(true);

    // Edit the note
    const note = notePage.getNoteByContent(originalContent);
    const updatedContent = `${testPrefix}-Updated Note`;
    await notePage.editNote(note, updatedContent);

    // Verify original content is gone
    noteExists = await notePage.noteExists(originalContent, 3000);
    expect(noteExists).toBe(false);

    // Verify updated content exists
    noteExists = await notePage.noteExists(updatedContent);
    expect(noteExists).toBe(true);
  });

  test('should delete a note', async ({ page, workViewPage, notePage, testPrefix }) => {
    await workViewPage.waitForTaskList();

    // Create a note
    const noteContent = `${testPrefix}-Note to Delete`;
    await notePage.addNote(noteContent);

    // Verify note exists
    let noteExists = await notePage.noteExists(noteContent);
    expect(noteExists).toBe(true);

    // Delete the note
    const note = notePage.getNoteByContent(noteContent);
    await notePage.deleteNote(note);

    // Verify note is deleted
    noteExists = await notePage.noteExists(noteContent, 3000);
    expect(noteExists).toBe(false);
  });

  test('should display notes in project context', async ({
    page,
    workViewPage,
    notePage,
    projectPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create a project
    const projectName = `${testPrefix}-Notes Project`;
    await projectPage.createProject(projectName);
    await projectPage.navigateToProjectByName(projectName);

    // Add a note in this project
    const noteContent = `${testPrefix}-Project Note`;
    await notePage.addNote(noteContent);

    // Verify note exists
    const noteExists = await notePage.noteExists(noteContent);
    expect(noteExists).toBe(true);
  });

  test('should create multiple notes', async ({
    page,
    workViewPage,
    notePage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // Create multiple notes
    const noteContent1 = `${testPrefix}-First Note`;
    const noteContent2 = `${testPrefix}-Second Note`;

    await notePage.addNote(noteContent1);
    await notePage.addNote(noteContent2);

    // Verify both notes exist
    const note1Exists = await notePage.noteExists(noteContent1);
    const note2Exists = await notePage.noteExists(noteContent2);

    expect(note1Exists).toBe(true);
    expect(note2Exists).toBe(true);

    // Verify note count
    const noteCount = await notePage.getNoteCount();
    expect(noteCount).toBeGreaterThanOrEqual(2);
  });
});
