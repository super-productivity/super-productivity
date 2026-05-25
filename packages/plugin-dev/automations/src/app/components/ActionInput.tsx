import { Action, ActionType } from '../../types';

interface ActionInputProps {
  action: Action;
  onChange: (action: Action) => void;
  onRemove: () => void;
}

export function ActionInput(props: ActionInputProps) {
  const types: ActionType[] = [
    'createTask',
    'deleteTask',
    'addTag',
    'moveToProject',
    'displaySnack',
    'displayDialog',
    'webhook',
  ];

  return (
    <div class="grid" style={{ 'margin-bottom': '0.5rem' }}>
      <div>
        <select
          value={props.action.type}
          onChange={(e) =>
            props.onChange({ ...props.action, type: e.currentTarget.value as ActionType })
          }
        >
          {types.map((t) => (
            <option value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <input
          type="text"
          value={props.action.value}
          onInput={(e) => props.onChange({ ...props.action, value: e.currentTarget.value })}
          placeholder="Value"
        />
      </div>
      <div style={{ width: 'auto', flex: '0' }}>
        <button
          class="secondary outline"
          onClick={props.onRemove}
          style={{ width: 'auto' }}
          title="Remove Action"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
