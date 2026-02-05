import { createSignal, createEffect } from 'solid-js';
import { Action, ActionType } from '../../types';
import { Dialog } from './Dialog';

interface ActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (action: Action) => void;
  initialAction?: Action;
  allowedTypes?: ActionType[];
}

export function ActionDialog(props: ActionDialogProps) {
  const [action, setAction] = createSignal<Action>({ type: 'createTask', value: '' });

  const allTypes: ActionType[] = [
    'createTask',
    'addTag',
    'displaySnack',
    'displayDialog',
    'webhook',
  ];
  const availableTypes = () =>
    props.allowedTypes ? allTypes.filter((t) => props.allowedTypes!.includes(t)) : allTypes;

  createEffect(() => {
    if (props.isOpen) {
      if (props.initialAction) {
        setAction({ ...props.initialAction });
      } else {
        const firstType = availableTypes()[0] || 'createTask';
        setAction({ type: firstType, value: '' });
      }
    }
  });

  const getPlaceholder = () => {
    switch (action().type) {
      case 'createTask':
        return 'e.g. "Follow up task"';
      case 'addTag':
        return 'e.g. "review-needed"';
      case 'displaySnack':
        return 'e.g. "Task completed!"';
      case 'displayDialog':
        return 'e.g. "Please remember to..."';
      case 'webhook':
        return 'e.g. "https://hooks.slack.com/..."';
      default:
        return '';
    }
  };

  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.initialAction ? 'Edit Action' : 'Add Action'}
      footer={
        <div class="grid">
          <button class="btn-outline" onClick={props.onClose}>
            Cancel
          </button>
          <button class="btn-primary" onClick={() => props.onSave(action())}>
            Save
          </button>
        </div>
      }
    >
      <label>
        Type
        <select
          value={action().type}
          onChange={(e) => setAction({ ...action(), type: e.currentTarget.value as ActionType })}
        >
          {availableTypes().map((t) => (
            <option value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Value
        <input
          type="text"
          value={action().value}
          onInput={(e) => setAction({ ...action(), value: e.currentTarget.value })}
          placeholder={getPlaceholder()}
        />
      </label>
      {action().type === 'webhook' && (
        <p
          style={{
            color: 'var(--color-warning)',
            'font-size': '0.875em',
            'margin-top': 'var(--s)',
          }}
        >
          ⚠️ Warning: Your full task data (including title, description, etc.) will be sent to this
          URL. Ensure the endpoint is secure.
        </p>
      )}
    </Dialog>
  );
}
