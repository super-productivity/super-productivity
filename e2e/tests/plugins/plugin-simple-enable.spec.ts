import { expect, test } from '../../fixtures/test.fixture';
import * as path from 'path';

const TEST_PLUGIN_ID = 'test-upload-plugin';

test.describe('Plugin Simple Enable', () => {
  test('upload and enable test plugin', async ({ workViewPage, settingsPage }) => {
    await workViewPage.waitForTaskList();

    // Navigate to plugin settings using page object
    await settingsPage.navigateToPluginSettings();

    // Upload plugin ZIP file
    const testPluginPath = path.resolve(__dirname, '../../../src/assets/test-plugin.zip');
    await settingsPage.uploadPlugin(testPluginPath);

    // Check if plugin was uploaded using Playwright's built-in waiting
    const pluginExists = await settingsPage.pluginExists(TEST_PLUGIN_ID);
    expect(pluginExists).toBeTruthy();

    // Enable the plugin using page object
    const enableResult = await settingsPage.enablePlugin(TEST_PLUGIN_ID);
    expect(enableResult).toBeTruthy();

    // Verify plugin is enabled
    const isEnabled = await settingsPage.isPluginEnabled(TEST_PLUGIN_ID);
    expect(isEnabled).toBeTruthy();

    // The test plugin has isSkipMenuEntry: true, so no menu entry should appear
    // and iFrame: false, so no iframe view
  });
});
