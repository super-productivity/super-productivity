import { createSignal, onMount, createEffect } from 'solid-js';
import { Condition, ConditionType } from '../../types';
import { Dialog } from './Dialog';

interface ConditionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (condition: Condition) => void;
  initialCondition?: Condition;
  projects?: any[];
  tags?: any[];
  allowedTypes?: ConditionType[];
}

export function ConditionDialog(props: ConditionDialogProps) {
  const [condition, setCondition] = createSignal<Condition>({ type: 'titleContains', value: '' });

  const allTypes: ConditionType[] = ['titleContains', 'projectIs', 'hasTag'];
  const availableTypes = () =>
    props.allowedTypes ? allTypes.filter((t) => props.allowedTypes!.includes(t)) : allTypes;

  createEffect(() => {
    if (props.isOpen) {
      if (props.initialCondition) {
        setCondition({ ...props.initialCondition });
      } else {
        // Default to first available type
        const firstType = availableTypes()[0] || 'titleContains';
        setCondition({ type: firstType, value: '' });
      }
    }
  });

  return (
    <Dialog
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.initialCondition ? 'Edit Condition' : 'Add Condition'}
      footer={
        <div class="grid">
          <button class="btn-outline" onClick={props.onClose}>
            Cancel
          </button>
          <button class="btn-primary" onClick={() => props.onSave(condition())}>
            Save
          </button>
        </div>
      }
    >
      <label>
        Type
        <select
          value={condition().type}
          onChange={(e) =>
            setCondition({ ...condition(), type: e.currentTarget.value as ConditionType })
          }
        >
          {availableTypes().map((t) => (
            <option value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Value
        {condition().type === 'projectIs' && props.projects ? (
          <select
            value={condition().value}
            onChange={(e) => setCondition({ ...condition(), value: e.currentTarget.value })}
          >
            <option value="">Select Project</option>
            {props.projects.map((p) => (
              <option value={p.title}>{p.title}</option>
            ))}
          </select>
        ) : condition().type === 'hasTag' && props.tags ? (
          <select
            value={condition().value}
            onChange={(e) => setCondition({ ...condition(), value: e.currentTarget.value })}
          >
            <option value="">Select Tag</option>
            {props.tags.map((t) => (
              <option value={t.title}>{t.title}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={condition().value}
            onInput={(e) => setCondition({ ...condition(), value: e.currentTarget.value })}
            placeholder={
              condition().type === 'titleContains'
                ? 'e.g. "bug"'
                : condition().type === 'projectIs'
                  ? 'e.g. "Project A"'
                  : 'e.g. "urgent"'
            }
          />
        )}
      </label>
    </Dialog>
  );
}
