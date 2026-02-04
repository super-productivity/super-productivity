import { For } from 'solid-js';
import { AutomationRule } from '../../types';

interface RuleListProps {
  rules: AutomationRule[];
  onEdit: (rule: AutomationRule) => void;
  onDelete: (rule: AutomationRule) => void;
  onToggleStatus: (rule: AutomationRule) => void;
  onCreate: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
}

export function RuleList(props: RuleListProps) {
  let fileInputRef: HTMLInputElement | undefined;

  const handleImportClick = () => {
    fileInputRef?.click();
  };

  const handleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      props.onImport(target.files[0]);
      target.value = ''; // Reset
    }
  };

  return (
    <div class="rule-list-container">
      <div class="grid">
        <div>
          <h2>Automation Rules</h2>
        </div>
        <div class="warning-box">
          <strong>Warning:</strong> The plugin is very powerful and using it can destroy your data.
          Use at your own risk!
        </div>

        <div style={{ 'text-align': 'right' }}>
          <input
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            ref={fileInputRef!}
            onChange={handleFileChange}
          />
          <button
            class="btn-outline"
            onClick={handleImportClick}
            style={{ 'margin-right': '0.5rem' }}
          >
            Import
          </button>
          <button class="btn-outline" onClick={props.onExport} style={{ 'margin-right': '0.5rem' }}>
            Export
          </button>
          <button class="btn-primary" onClick={props.onCreate}>
            + New Rule
          </button>
        </div>
      </div>

      <figure>
        <table role="grid">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Trigger</th>
              <th scope="col">Status</th>
              <th scope="col" style={{ 'text-align': 'right' }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <For
              each={props.rules}
              fallback={
                <tr>
                  <td colspan={4}>No rules found. Create one to get started!</td>
                </tr>
              }
            >
              {(rule) => (
                <tr>
                  <td>{rule.name}</td>
                  <td>
                    {rule.trigger.type}
                    {rule.trigger.value ? ` (${rule.trigger.value})` : ''}
                  </td>
                  <td style={{ 'text-align': 'right', 'white-space': 'nowrap' }}>
                    <label>
                      <input
                        type="checkbox"
                        checked={rule.isEnabled}
                        onChange={() => props.onToggleStatus(rule)}
                      />
                      {rule.isEnabled ? ' Enabled' : ' Disabled'}
                    </label>
                  </td>
                  <td style={{ 'text-align': 'right', 'white-space': 'nowrap' }}>
                    <button
                      class="btn-outline"
                      onClick={() => props.onEdit(rule)}
                      style={{ 'margin-right': '0.5rem' }}
                    >
                      Edit
                    </button>
                    <button onClick={() => props.onDelete(rule)}>Delete</button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </figure>
    </div>
  );
}
