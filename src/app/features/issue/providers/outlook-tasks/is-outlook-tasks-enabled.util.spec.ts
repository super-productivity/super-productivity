import { isOutlookTasksEnabled } from './is-outlook-tasks-enabled.util';
import { OutlookTasksCfg } from './outlook-tasks.model';

describe('isOutlookTasksEnabled', () => {
  const makeCfg = (overrides: Partial<OutlookTasksCfg> = {}): OutlookTasksCfg => ({
    isEnabled: false,
    clientId: null,
    tenantId: null,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    taskListId: null,
    ...overrides,
  });

  it('should return false for null/undefined cfg', () => {
    expect(isOutlookTasksEnabled(null as any)).toBe(false);
    expect(isOutlookTasksEnabled(undefined as any)).toBe(false);
  });

  it('should return false when isEnabled is false', () => {
    expect(
      isOutlookTasksEnabled(
        makeCfg({ isEnabled: false, clientId: 'c', accessToken: 't' }),
      ),
    ).toBe(false);
  });

  it('should return false when clientId is missing', () => {
    expect(
      isOutlookTasksEnabled(
        makeCfg({ isEnabled: true, clientId: null, accessToken: 't' }),
      ),
    ).toBe(false);
  });

  it('should return false when accessToken is missing', () => {
    expect(
      isOutlookTasksEnabled(
        makeCfg({ isEnabled: true, clientId: 'c', accessToken: null }),
      ),
    ).toBe(false);
  });

  it('should return true when all required fields are present', () => {
    expect(
      isOutlookTasksEnabled(
        makeCfg({ isEnabled: true, clientId: 'c', accessToken: 't' }),
      ),
    ).toBe(true);
  });

  it('should return false for empty string clientId', () => {
    expect(
      isOutlookTasksEnabled(makeCfg({ isEnabled: true, clientId: '', accessToken: 't' })),
    ).toBe(false);
  });

  it('should return false for empty string accessToken', () => {
    expect(
      isOutlookTasksEnabled(makeCfg({ isEnabled: true, clientId: 'c', accessToken: '' })),
    ).toBe(false);
  });
});
