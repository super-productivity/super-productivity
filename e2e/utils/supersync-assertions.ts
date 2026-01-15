import { expect } from '@playwright/test';
import {
  getTaskElement,
  getDoneTaskElement,
  getSubtaskElement,
  getDoneSubtaskElement,
  getUndoneSubtaskElement,
  getTaskCount,
  getTaskTitles,
  hasTaskOnClient,
  type SimulatedE2EClient,
} from './supersync-helpers';

/**
 * Assertion helpers for SuperSync E2E tests.
 *
 * These provide reusable, readable assertions for common sync test patterns.
 */

// ============================================================================
// Task Visibility Assertions
// ============================================================================

/**
 * Assert a task is visible on a client.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectTaskVisible = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  await expect(task).toBeVisible({ timeout });
};

/**
 * Assert a task is NOT visible on a client.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectTaskNotVisible = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  await expect(task).not.toBeVisible({ timeout });
};

/**
 * Assert a task is done (visible with done state).
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectTaskDone = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  const task = getDoneTaskElement(client, taskName);
  await expect(task).toBeVisible({ timeout });
};

/**
 * Assert a subtask is visible.
 *
 * @param client - The simulated E2E client
 * @param taskName - The subtask name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectSubtaskVisible = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  const task = getSubtaskElement(client, taskName);
  await expect(task).toBeVisible({ timeout });
};

/**
 * Assert a subtask is done.
 *
 * @param client - The simulated E2E client
 * @param taskName - The subtask name to check
 * @param timeout - Optional timeout in ms (default: 5000)
 */
export const expectSubtaskDone = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 5000,
): Promise<void> => {
  const task = getDoneSubtaskElement(client, taskName);
  await expect(task).toBeVisible({ timeout });
};

/**
 * Assert a subtask is NOT done.
 *
 * @param client - The simulated E2E client
 * @param taskName - The subtask name to check
 * @param timeout - Optional timeout in ms (default: 5000)
 */
export const expectSubtaskNotDone = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 5000,
): Promise<void> => {
  const task = getUndoneSubtaskElement(client, taskName);
  await expect(task).toBeVisible({ timeout });
};

// ============================================================================
// Multi-Client Assertions
// ============================================================================

/**
 * Assert a task exists on all provided clients.
 *
 * @param clients - Array of simulated E2E clients
 * @param taskName - The task name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectTaskOnAllClients = async (
  clients: SimulatedE2EClient[],
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  await Promise.all(
    clients.map((client) => expectTaskVisible(client, taskName, timeout)),
  );
};

/**
 * Assert a task does NOT exist on any of the provided clients.
 *
 * @param clients - Array of simulated E2E clients
 * @param taskName - The task name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectTaskNotOnAnyClient = async (
  clients: SimulatedE2EClient[],
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  await Promise.all(
    clients.map((client) => expectTaskNotVisible(client, taskName, timeout)),
  );
};

/**
 * Assert a task is done on all provided clients.
 *
 * @param clients - Array of simulated E2E clients
 * @param taskName - The task name to check
 * @param timeout - Optional timeout in ms (default: 10000)
 */
export const expectTaskDoneOnAllClients = async (
  clients: SimulatedE2EClient[],
  taskName: string,
  timeout = 10000,
): Promise<void> => {
  await Promise.all(clients.map((client) => expectTaskDone(client, taskName, timeout)));
};

/**
 * Assert task count is equal across all clients.
 *
 * @param clients - Array of simulated E2E clients
 */
export const expectEqualTaskCount = async (
  clients: SimulatedE2EClient[],
): Promise<void> => {
  const counts = await Promise.all(clients.map((client) => getTaskCount(client)));
  const firstCount = counts[0];
  for (let i = 1; i < counts.length; i++) {
    expect(counts[i]).toBe(firstCount);
  }
};

/**
 * Assert task count is a specific value on a client.
 *
 * @param client - The simulated E2E client
 * @param expectedCount - The expected task count
 */
export const expectTaskCount = (
  client: SimulatedE2EClient,
  expectedCount: number,
): Promise<void> => {
  return getTaskCount(client).then((count) => {
    expect(count).toBe(expectedCount);
  });
};

/**
 * Assert task order matches across clients.
 *
 * @param clientA - First client
 * @param clientB - Second client
 */
export const expectTaskOrderMatches = async (
  clientA: SimulatedE2EClient,
  clientB: SimulatedE2EClient,
): Promise<void> => {
  const orderA = await getTaskTitles(clientA);
  const orderB = await getTaskTitles(clientB);
  expect(orderA).toEqual(orderB);
};

/**
 * Assert all clients have the same task order.
 *
 * @param clients - Array of simulated E2E clients
 */
export const expectSameTaskOrder = async (
  clients: SimulatedE2EClient[],
): Promise<void> => {
  if (clients.length < 2) return;

  const orders = await Promise.all(clients.map((client) => getTaskTitles(client)));
  const firstOrder = orders[0];
  for (let i = 1; i < orders.length; i++) {
    expect(orders[i]).toEqual(firstOrder);
  }
};

/**
 * Assert a task exists on a client (boolean check).
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name to check
 * @param exists - Whether the task should exist (default: true)
 */
export const expectTaskExists = async (
  client: SimulatedE2EClient,
  taskName: string,
  exists = true,
): Promise<void> => {
  const hasIt = await hasTaskOnClient(client, taskName);
  expect(hasIt).toBe(exists);
};

// ============================================================================
// Consistency Assertions
// ============================================================================

/**
 * Assert all clients have consistent state (same task count and tasks visible).
 *
 * @param clients - Array of simulated E2E clients
 * @param taskNames - Array of task names that should exist on all clients
 */
export const expectConsistentState = async (
  clients: SimulatedE2EClient[],
  taskNames: string[],
): Promise<void> => {
  await expectEqualTaskCount(clients);
  for (const taskName of taskNames) {
    await expectTaskOnAllClients(clients, taskName);
  }
};

/**
 * Assert time tracking indicator is visible on a task.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name
 * @param timeout - Optional timeout in ms (default: 5000)
 */
export const expectTimeTrackingActive = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 5000,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  const indicator = task.locator('.play-icon-indicator');
  await expect(indicator).toBeVisible({ timeout });
};

/**
 * Assert time tracking indicator is NOT visible on a task.
 *
 * @param client - The simulated E2E client
 * @param taskName - The task name
 * @param timeout - Optional timeout in ms (default: 5000)
 */
export const expectTimeTrackingInactive = async (
  client: SimulatedE2EClient,
  taskName: string,
  timeout = 5000,
): Promise<void> => {
  const task = getTaskElement(client, taskName);
  const indicator = task.locator('.play-icon-indicator');
  await expect(indicator).not.toBeVisible({ timeout });
};
