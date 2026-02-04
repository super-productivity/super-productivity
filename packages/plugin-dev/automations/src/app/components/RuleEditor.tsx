import { For, createSignal, createEffect } from 'solid-js';
import { AutomationRule, AutomationTriggerType, Condition, Action } from '../../types';
import { Dialog } from './Dialog';
import { ConditionDialog } from './ConditionDialog';
import { ActionDialog } from './ActionDialog';

interface RuleEditorProps {
  isOpen: boolean;
  rule: AutomationRule;
  projects?: any[];
  tags?: any[];
  onSave: (rule: AutomationRule) => void;
  onDelete: (rule: AutomationRule) => void;
  onCancel: () => void;
}

export function RuleEditor(props: RuleEditorProps) {
  // We need local state for the rule being edited to allow cancelling changes
  // But for simplicity in this MVP, we'll edit the prop directly or assume parent handles cloning.
  // To properly support "Cancel", we should clone on open.
  // Let's assume parent passes a clone or we clone it here.
  // Since we can't easily clone in a functional component body without effects, let's rely on the parent passing a fresh object or clone.

  // However, we need to manage the state of child dialogs.
  const [isConditionDialogOpen, setIsConditionDialogOpen] = createSignal(false);
  const [editingConditionIndex, setEditingConditionIndex] = createSignal<number>(-1);

  const [isActionDialogOpen, setIsActionDialogOpen] = createSignal(false);
  const [editingActionIndex, setEditingActionIndex] = createSignal<number>(-1);

  const updateRule = (updates: Partial<AutomationRule>) => {
    // This mutates the prop if it's a store or object, which is fine if parent passed a clone.
    // If we want to be pure, we should emit an update, but here we are "editing" before "saving".
    // We'll assume `props.rule` is the "draft" object.
    Object.assign(props.rule, updates);
    // Force update if needed? Solid's reactivity should handle it if `props.rule` is a store or signal.
    // If it's a plain object, we might need a local signal.
    // Let's assume `props.rule` is reactive or we use a local store.
    // For this refactor, let's use a local signal initialized from props.
  };

  // Actually, let's use a local signal for the rule to ensure reactivity and cancellation support
  const [localRule, setLocalRule] = createSignal<AutomationRule>(props.rule);

  // Sync local rule when prop changes (dialog opens)

  createEffect(() => {
    if (props.isOpen) {
      setLocalRule(JSON.parse(JSON.stringify(props.rule)));
    }
  });

  const saveLocalRule = () => {
    props.onSave(localRule());
  };

  const triggerTypes: AutomationTriggerType[] = [
    'taskCreated',
    'taskUpdated',
    'taskCompleted',
    'timeBased',
  ];

  const isTimeBased = () => localRule().trigger.type === 'timeBased';

  const allowedConditionTypes = (): import('../../types').ConditionType[] => {
    if (isTimeBased()) return [];
    return ['titleContains', 'projectIs', 'hasTag'];
  };

  const allowedActionTypes = (): import('../../types').ActionType[] => {
    if (isTimeBased()) {
      return ['createTask', 'displaySnack', 'displayDialog', 'webhook'];
    }
    return ['createTask', 'addTag', 'displaySnack', 'displayDialog', 'webhook'];
  };

  // Condition handlers
  const handleSaveCondition = (condition: Condition) => {
    const currentRule = localRule();
    const newConditions = [...currentRule.conditions];
    if (editingConditionIndex() >= 0) {
      newConditions[editingConditionIndex()] = condition;
    } else {
      newConditions.push(condition);
    }
    setLocalRule({ ...currentRule, conditions: newConditions });
    setIsConditionDialogOpen(false);
  };

  const handleRemoveCondition = (index: number) => {
    const currentRule = localRule();
    const newConditions = currentRule.conditions.filter((_, i) => i !== index);
    setLocalRule({ ...currentRule, conditions: newConditions });
  };

  // Action handlers
  const handleSaveAction = (action: Action) => {
    const currentRule = localRule();
    const newActions = [...currentRule.actions];
    if (editingActionIndex() >= 0) {
      newActions[editingActionIndex()] = action;
    } else {
      newActions.push(action);
    }
    setLocalRule({ ...currentRule, actions: newActions });
    setIsActionDialogOpen(false);
  };

  const handleRemoveAction = (index: number) => {
    const currentRule = localRule();
    const newActions = currentRule.actions.filter((_, i) => i !== index);
    setLocalRule({ ...currentRule, actions: newActions });
  };

  return (
    <>
      <Dialog
        isOpen={props.isOpen}
        onClose={props.onCancel}
        title={localRule().id ? 'Edit Rule' : 'New Rule'}
        footer={
          <div class="grid">
            <div style={{ 'text-align': 'left' }}>
              {localRule().id && (
                <button onClick={() => props.onDelete(localRule())}>Delete Rule</button>
              )}
            </div>
            <div style={{ 'text-align': 'right' }}>
              <button
                class="btn-outline"
                onClick={props.onCancel}
                style={{ 'margin-right': '0.5rem' }}
              >
                Cancel
              </button>
              <button class="btn-primary" onClick={saveLocalRule}>
                Save Rule
              </button>
            </div>
          </div>
        }
      >
        <form onSubmit={(e) => e.preventDefault()}>
          <label>
            Rule Name
            <input
              type="text"
              value={localRule().name}
              onInput={(e) => setLocalRule({ ...localRule(), name: e.currentTarget.value })}
              placeholder="e.g. Auto-tag urgent tasks"
            />
          </label>

          <label>
            Trigger
            <select
              value={localRule().trigger.type}
              onChange={(e) =>
                setLocalRule({
                  ...localRule(),
                  trigger: { type: e.currentTarget.value as AutomationTriggerType },
                })
              }
            >
              {triggerTypes.map((t) => (
                <option value={t}>{t}</option>
              ))}
            </select>
          </label>

          {localRule().trigger.type === 'timeBased' && (
            <>
              <div class="warning-box">
                <small>
                  <strong>Warning:</strong> Time-based triggers only work if the app is running.
                  They might not work reliably if the app is in the background.
                  <br />
                  <em>Note: Conditions and some actions are restricted for time-based triggers.</em>
                </small>
              </div>

              <label>
                Time (24h format)
                <input
                  type="time"
                  value={localRule().trigger.value || ''}
                  onInput={(e) =>
                    setLocalRule({
                      ...localRule(),
                      trigger: { ...localRule().trigger, value: e.currentTarget.value },
                    })
                  }
                  required
                />
              </label>
            </>
          )}

          {allowedConditionTypes().length > 0 && (
            <>
              <hr />

              <div class="section">
                <div class="grid">
                  <div>
                    <h4>Conditions</h4>
                  </div>
                  <div style={{ 'text-align': 'right' }}>
                    <button
                      onClick={() => {
                        setEditingConditionIndex(-1);
                        setIsConditionDialogOpen(true);
                      }}
                    >
                      + Add
                    </button>
                  </div>
                </div>

                <table role="grid">
                  <tbody>
                    <For
                      each={localRule().conditions}
                      fallback={
                        <tr>
                          <td colspan={2}>
                            <small>No conditions</small>
                          </td>
                        </tr>
                      }
                    >
                      {(condition, i) => (
                        <tr>
                          <td>
                            {condition.type}: {condition.value}
                          </td>
                          <td style={{ 'text-align': 'right' }}>
                            <button
                              class="btn-outline"
                              onClick={() => {
                                setEditingConditionIndex(i());
                                setIsConditionDialogOpen(true);
                              }}
                              style={{ 'margin-right': '0.5rem' }}
                            >
                              Edit
                            </button>
                            <button onClick={() => handleRemoveCondition(i())}>✕</button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </>
          )}

          <hr />

          <div class="section">
            <div class="grid">
              <div>
                <h4>Actions</h4>
              </div>
              <div style={{ 'text-align': 'right' }}>
                <button
                  onClick={() => {
                    setEditingActionIndex(-1);
                    setIsActionDialogOpen(true);
                  }}
                >
                  + Add
                </button>
              </div>
            </div>

            <table role="grid">
              <tbody>
                <For
                  each={localRule().actions}
                  fallback={
                    <tr>
                      <td colspan={2}>
                        <small>No actions</small>
                      </td>
                    </tr>
                  }
                >
                  {(action, i) => (
                    <tr>
                      <td>
                        {action.type}: {action.value}
                      </td>
                      <td style={{ 'text-align': 'right' }}>
                        <button
                          class="btn-outline"
                          onClick={() => {
                            setEditingActionIndex(i());
                            setIsActionDialogOpen(true);
                          }}
                          style={{ 'margin-right': '0.5rem' }}
                        >
                          Edit
                        </button>
                        <button onClick={() => handleRemoveAction(i())}>✕</button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </form>
      </Dialog>

      <ConditionDialog
        isOpen={isConditionDialogOpen()}
        onClose={() => setIsConditionDialogOpen(false)}
        onSave={handleSaveCondition}
        projects={props.projects}
        tags={props.tags}
        initialCondition={
          editingConditionIndex() >= 0 ? localRule().conditions[editingConditionIndex()] : undefined
        }
        allowedTypes={allowedConditionTypes()}
      />

      <ActionDialog
        isOpen={isActionDialogOpen()}
        onClose={() => setIsActionDialogOpen(false)}
        onSave={handleSaveAction}
        initialAction={
          editingActionIndex() >= 0 ? localRule().actions[editingActionIndex()] : undefined
        }
        allowedTypes={allowedActionTypes()}
      />
    </>
  );
}
