import { createSignal, createEffect, createMemo, Show } from 'solid-js';
import { Condition, ConditionType } from '../../types';
import { Dialog } from './Dialog';

interface ConditionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (condition: Condition) => void;
  initialCondition?: Condition;
  projects?: { id: string; title: string }[];
  tags?: { id: string; title: string }[];
  allowedTypes?: ConditionType[];
}

const supportsRegex = (type: ConditionType): boolean =>
  type === 'titleContains' || type === 'titleStartsWith';

const getDefaultCondition = (type: ConditionType): Condition => ({
  type,
  value: '',
  isRegex: false,
});

export function ConditionDialog(props: ConditionDialogProps) {
  const [condition, setCondition] = createSignal<Condition>(getDefaultCondition('titleContains'));

  const allTypes: ConditionType[] = [
    'titleContains',
    'titleStartsWith',
    'projectIs',
    'hasTag',
    'weekdayIs',
  ];
  const availableTypes = () =>
    props.allowedTypes ? allTypes.filter((t) => props.allowedTypes!.includes(t)) : allTypes;

  const regexError = createMemo((): string => {
    const currentCondition = condition();
    if (
      !supportsRegex(currentCondition.type) ||
      !currentCondition.isRegex ||
      !currentCondition.value
    ) {
      return '';
    }

    try {
      new RegExp(currentCondition.value, 'i');
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid regular expression';
    }
  });

  createEffect(() => {
    if (props.isOpen) {
      if (props.initialCondition) {
        setCondition({
          ...props.initialCondition,
          isRegex: Boolean(props.initialCondition.isRegex),
        });
      } else {
        const firstType = availableTypes()[0] || 'titleContains';
        setCondition(getDefaultCondition(firstType));
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
          <button
            class="btn-primary"
            disabled={Boolean(regexError())}
            onClick={() => props.onSave(condition())}
          >
            Save
          </button>
        </div>
      }
    >
      <label>
        Type
        <select
          value={condition().type}
          onChange={(e) => {
            const nextType = e.currentTarget.value as ConditionType;
            setCondition({
              ...condition(),
              type: nextType,
              isRegex: supportsRegex(nextType) ? Boolean(condition().isRegex) : false,
            });
          }}
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
              <option value={p.id}>{p.title}</option>
            ))}
          </select>
        ) : condition().type === 'hasTag' && props.tags ? (
          <select
            value={condition().value}
            onChange={(e) => setCondition({ ...condition(), value: e.currentTarget.value })}
          >
            <option value="">Select Tag</option>
            {props.tags.map((t) => (
              <option value={t.id}>{t.title}</option>
            ))}
          </select>
        ) : (
          <>
            <div class="input-with-toggle">
              <input
                type="text"
                value={condition().value}
                onInput={(e) => setCondition({ ...condition(), value: e.currentTarget.value })}
                placeholder={
                  condition().type === 'titleContains' || condition().type === 'titleStartsWith'
                    ? condition().isRegex
                      ? 'e.g. "^bug(\\s|:)"'
                      : 'e.g. "bug"'
                    : condition().type === 'projectIs'
                      ? 'e.g. "Project A"'
                      : condition().type === 'weekdayIs'
                        ? 'e.g. "Monday"'
                        : 'e.g. "urgent"'
                }
              />
              {supportsRegex(condition().type) && (
                <button
                  type="button"
                  class={
                    condition().isRegex ? 'btn-primary regex-toggle' : 'btn-outline regex-toggle'
                  }
                  aria-pressed={condition().isRegex ? 'true' : 'false'}
                  onClick={() => setCondition({ ...condition(), isRegex: !condition().isRegex })}
                >
                  Regex
                </button>
              )}
            </div>
            <Show when={regexError()}>
              <small class="field-error" role="alert">
                Invalid regex: {regexError()}
              </small>
            </Show>
          </>
        )}
      </label>
    </Dialog>
  );
}
