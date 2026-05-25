import { render, screen, fireEvent } from '@solidjs/testing-library';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RuleEditor } from './RuleEditor';
import { AutomationRule } from '../../types';

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  }

  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
});

const createRule = (triggerType: AutomationRule['trigger']['type']): AutomationRule => ({
  id: 'rule-1',
  name: 'Test rule',
  isEnabled: true,
  trigger:
    triggerType === 'timeBased' ? { type: 'timeBased', value: '09:00' } : { type: triggerType },
  conditions: [],
  actions: [],
});

describe('RuleEditor', () => {
  it('shows moveToProject for task-based rules and provides project choices', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('taskCreated')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    const actionDialog = screen.getByText('Add Action').closest('dialog');
    expect(actionDialog).not.toBeNull();

    const typeSelect = actionDialog!.querySelector('label select') as HTMLSelectElement | null;
    expect(typeSelect).not.toBeNull();
    expect(typeSelect!.querySelector('option[value="moveToProject"]')).not.toBeNull();

    fireEvent.change(typeSelect!, { target: { value: 'moveToProject' } });

    const selects = actionDialog!.querySelectorAll('select');
    const valueSelect = selects[1] as HTMLSelectElement | undefined;
    expect(valueSelect).toBeDefined();
    expect(valueSelect?.querySelector('option[value="p1"]')).not.toBeNull();
  });

  it('allows enabling regex for title conditions and persists it in the rule summary', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('taskCreated')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.click(screen.getAllByText('+ Add')[0]);

    const conditionDialog = screen.getByText('Add Condition').closest('dialog');
    expect(conditionDialog).not.toBeNull();

    const regexButton = Array.from(conditionDialog!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Regex',
    ) as HTMLButtonElement | undefined;
    expect(regexButton).toBeDefined();
    expect(regexButton?.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(regexButton!);
    expect(regexButton?.getAttribute('aria-pressed')).toBe('true');

    const valueInput = conditionDialog!.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement | null;
    expect(valueInput).not.toBeNull();
    fireEvent.input(valueInput!, { target: { value: '^Bug' } });

    const saveButton = conditionDialog!.querySelector(
      'footer .btn-primary',
    ) as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    fireEvent.click(saveButton!);

    expect(screen.queryByText('titleContains (regex): ^Bug')).not.toBeNull();
  });

  it('blocks saving invalid regex patterns and shows an inline error', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('taskCreated')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.click(screen.getAllByText('+ Add')[0]);

    const conditionDialog = screen.getByText('Add Condition').closest('dialog');
    expect(conditionDialog).not.toBeNull();

    const regexButton = Array.from(conditionDialog!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Regex',
    ) as HTMLButtonElement | undefined;
    expect(regexButton).toBeDefined();
    fireEvent.click(regexButton!);

    const valueInput = conditionDialog!.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement | null;
    expect(valueInput).not.toBeNull();
    fireEvent.input(valueInput!, { target: { value: '[' } });

    expect(screen.queryByRole('alert')?.textContent).toContain('Invalid regex:');

    const saveButton = conditionDialog!.querySelector(
      'footer .btn-primary',
    ) as HTMLButtonElement | null;
    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(true);
  });

  it('hides the regex toggle for non-title condition types', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('taskCreated')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[{ id: 't1', title: 'Urgent' }]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.click(screen.getAllByText('+ Add')[0]);

    const conditionDialog = screen.getByText('Add Condition').closest('dialog');
    expect(conditionDialog).not.toBeNull();

    const typeSelect = conditionDialog!.querySelector('label select') as HTMLSelectElement | null;
    expect(typeSelect).not.toBeNull();
    fireEvent.change(typeSelect!, { target: { value: 'projectIs' } });

    const regexButton = Array.from(conditionDialog!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Regex',
    );
    expect(regexButton).toBeUndefined();
  });

  it('shows deleteTask for task-based rules', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('taskCreated')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    const actionDialog = screen.getByText('Add Action').closest('dialog');
    expect(actionDialog).not.toBeNull();

    const typeSelect = actionDialog!.querySelector('label select') as HTMLSelectElement | null;
    expect(typeSelect).not.toBeNull();
    expect(typeSelect!.querySelector('option[value="deleteTask"]')).not.toBeNull();
  });

  it('keeps deleteTask unavailable for time-based rules', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('timeBased')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    const actionDialog = screen.getByText('Add Action').closest('dialog');
    expect(actionDialog).not.toBeNull();

    const typeSelect = actionDialog!.querySelector('label select') as HTMLSelectElement | null;
    expect(typeSelect).not.toBeNull();
    expect(typeSelect!.querySelector('option[value="deleteTask"]')).toBeNull();
  });

  it('keeps moveToProject unavailable for time-based rules', () => {
    render(() => (
      <RuleEditor
        isOpen={true}
        rule={createRule('timeBased')}
        projects={[{ id: 'p1', title: 'Project A' }]}
        tags={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    const actionDialog = screen.getByText('Add Action').closest('dialog');
    expect(actionDialog).not.toBeNull();

    const typeSelect = actionDialog!.querySelector('label select') as HTMLSelectElement | null;
    expect(typeSelect).not.toBeNull();
    expect(typeSelect!.querySelector('option[value="moveToProject"]')).toBeNull();
  });
});
