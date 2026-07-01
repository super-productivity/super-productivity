import { generatePlainspaceTaskId } from './generate-plainspace-task-id';

describe('generatePlainspaceTaskId', () => {
  it('should return a deterministic ID for the same inputs', () => {
    const id1 = generatePlainspaceTaskId('provider-abc', 'issue-123');
    const id2 = generatePlainspaceTaskId('provider-abc', 'issue-123');
    expect(id1).toBe(id2);
  });

  it('should return different IDs for different provider IDs', () => {
    const id1 = generatePlainspaceTaskId('provider-abc', 'issue-123');
    const id2 = generatePlainspaceTaskId('provider-xyz', 'issue-123');
    expect(id1).not.toBe(id2);
  });

  it('should return different IDs for different issue IDs', () => {
    const id1 = generatePlainspaceTaskId('provider-abc', 'issue-123');
    const id2 = generatePlainspaceTaskId('provider-abc', 'issue-456');
    expect(id1).not.toBe(id2);
  });

  it('should start with ps_ prefix and not collide with calendar (cal_) ids', () => {
    const id = generatePlainspaceTaskId('provider-abc', 'issue-123');
    expect(id).toMatch(/^ps_/);
    expect(id).not.toMatch(/^cal_/);
  });

  it('should produce a stable known value to guard against algorithm changes', () => {
    const id = generatePlainspaceTaskId('provider-abc', 'issue-123');
    expect(id).toBe('ps_provider-abc_issue-123');
  });
});
