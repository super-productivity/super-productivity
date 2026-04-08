import { createEffect, createSignal } from 'solid-js';
import { Action, ActionType } from '../../types';
import { Dialog } from './Dialog';

interface ActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (action: Action) => void;
  initialAction?: Action;
  projects?: { id: string; title: string }[];
  allowedTypes?: ActionType[];
}

export function ActionDialog(props: ActionDialogProps) {
  const [action, setAction] = createSignal<Action>({ type: 'createTask', value: '' });

  const allTypes: ActionType[] = [
    'createTask',
    'deleteTask',
    'addTag',
    'moveToProject',
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
      case 'deleteTask':
        return 'Deletes the task that triggered this rule';
      case 'addTag':
        return 'e.g. "review-needed"';
      case 'moveToProject':
        return 'e.g. "Project A"';
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

  const handleTypeChange = (type: ActionType) => {
    setAction({
      ...action(),
      type,
      value: type === 'deleteTask' ? '' : action().value,
    });
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
          <button
            class="btn-primary"
            disabled={action().type !== 'deleteTask' && !action().value.trim()}
            onClick={() => props.onSave(action())}
          >
            Save
          </button>
        </div>
      }
    >
      <label>
        Type
        <select
          value={action().type}
          onChange={(e) => handleTypeChange(e.currentTarget.value as ActionType)}
        >
          {availableTypes().map((t) => (
            <option value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Value
        {action().type === 'moveToProject' && props.projects?.length ? (
          <select
            value={action().value}
            onChange={(e) => setAction({ ...action(), value: e.currentTarget.value })}
          >
            <option value="">Select Project</option>
            {props.projects.map((p) => (
              <option value={p.id}>{p.title}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={action().value}
            disabled={action().type === 'deleteTask'}
            onInput={(e) => setAction({ ...action(), value: e.currentTarget.value })}
            placeholder={getPlaceholder()}
          />
        )}
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
