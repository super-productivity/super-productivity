import { parseMarkdownWithHeader } from './markdown-parser';
import { generateTaskOperations } from './generate-task-operations';
// import { Task } from '@super-productivity/plugin-api';

/**
 * Replicate markdown content to Super Productivity tasks
 * Uses the new generateTaskOperations function for proper bidirectional sync
 */
export const mdToSp = async (
  markdownContent: string,
  projectId: string,
): Promise<void> => {
  try {
    // Parse markdown with error tracking
    const parseResult = parseMarkdownWithHeader(markdownContent);
    const parsedTasks = parseResult.tasks;

    // Report parse errors to user if any
    if (parseResult.errors && parseResult.errors.length > 0) {
      const errorMsg = `Found ${parseResult.errors.length} issue(s) in markdown:\n${parseResult.errors.slice(0, 3).join('\n')}`;
      console.warn('[sync-md]', errorMsg);

      PluginAPI.showSnack({
        msg: `Sync.md: ${parseResult.errors.length} parsing issue(s). Check console for details.`,
        type: 'WARNING',
      });
    }

    // Get current state
    const currentTasks = await PluginAPI.getTasks();
    const currentProjects = await PluginAPI.getAllProjects();

    if (!currentProjects.find((p) => p.id === projectId)) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Filter tasks for the specific project
    const projectTasks = currentTasks.filter((task) => task.projectId === projectId);

    // Generate operations with validation
    const operations = generateTaskOperations(parsedTasks, projectTasks, projectId);

    // Execute batch operations
    if (operations.length > 0) {
      console.log(
        `[sync-md] Executing ${operations.length} sync operations for project ${projectId}`,
        operations,
      );

      const result = await PluginAPI.batchUpdateForProject({
        projectId,
        operations,
      });

      // Handle batch operation errors
      if (!result.success && result.errors && result.errors.length > 0) {
        const errorSummary = result.errors
          .map((e) => `Op ${e.operationIndex}: ${e.message}`)
          .slice(0, 3)
          .join('; ');

        throw new Error(`Batch operations failed: ${errorSummary}`);
      }

      console.log('[sync-md] Sync operations completed successfully');
    }
  } catch (error) {
    console.error('[sync-md] Error in mdToSp:', error);

    // Show user-friendly error notification
    PluginAPI.showSnack({
      msg: `Sync.md: Failed to sync markdown to SP. ${error instanceof Error ? error.message : 'Unknown error'}`,
      type: 'ERROR',
    });

    // Re-throw to allow caller to handle if needed
    throw error;
  }
};
