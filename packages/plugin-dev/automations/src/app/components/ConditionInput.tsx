import { Condition, ConditionType } from '../../types';

interface ConditionInputProps {
  condition: Condition;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
}

export function ConditionInput(props: ConditionInputProps) {
  const types: ConditionType[] = [
    'titleContains',
    'titleStartsWith',
    'projectIs',
    'hasTag',
    'weekdayIs',
  ];

  return (
    <div class="grid" style={{ 'margin-bottom': '0.5rem' }}>
      <div>
        <select
          value={props.condition.type}
          onChange={(e) =>
            props.onChange({ ...props.condition, type: e.currentTarget.value as ConditionType })
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
          value={props.condition.value}
          onInput={(e) => props.onChange({ ...props.condition, value: e.currentTarget.value })}
          placeholder="Value"
        />
      </div>
      <div style={{ width: 'auto', flex: '0' }}>
        <button
          class="secondary outline"
          onClick={props.onRemove}
          style={{ width: 'auto' }}
          title="Remove Condition"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
