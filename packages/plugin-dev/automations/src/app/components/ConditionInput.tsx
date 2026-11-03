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
    <div class="row">
      <div class="grow">
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
      <div class="grow">
        <input
          type="text"
          value={props.condition.value}
          onInput={(e) => props.onChange({ ...props.condition, value: e.currentTarget.value })}
          placeholder="Value"
        />
      </div>
      <button
        class="btn-icon"
        onClick={props.onRemove}
        title="Remove Condition"
        aria-label="Remove Condition"
      >
        ✕
      </button>
    </div>
  );
}
