import { createSignal, onMount } from 'solid-js';
import './App.css';
import { RuleList } from './components/RuleList';
import { RuleEditor } from './components/RuleEditor';
import { AutomationRule } from '../types';
import { exportRules } from '../utils/export-rules';
import { sendMessage } from '../utils/messaging';
import { validateRule } from '../utils/rule-validator';

function App() {
  const [isLoading, setIsLoading] = createSignal(true);
  const [rules, setRules] = createSignal<AutomationRule[]>([]);
  const [editingRule, setEditingRule] = createSignal<AutomationRule | null>(null);
  const [isEditorOpen, setIsEditorOpen] = createSignal(false);

  const [projects, setProjects] = createSignal<any[]>([]);
  const [tags, setTags] = createSignal<any[]>([]);

  const fetchRules = async () => {
    const fetchedRules = (await sendMessage('getRules')) as AutomationRule[];
    setRules(fetchedRules);
  };

  const fetchData = async () => {
    try {
      const [fetchedProjects, fetchedTags] = await Promise.all([
        sendMessage('getProjects'),
        sendMessage('getTags'),
      ]);
      setProjects(fetchedProjects as any[]);
      setTags(fetchedTags as any[]);
    } catch (e) {
      console.error('Failed to fetch data', e);
    }
  };

  onMount(async () => {
    await Promise.all([fetchRules(), fetchData()]);
    setIsLoading(false);
  });

  const handleEdit = (rule: AutomationRule) => {
    setEditingRule(JSON.parse(JSON.stringify(rule))); // Deep clone
    setIsEditorOpen(true);
  };

  const handleCreate = () => {
    setEditingRule({
      id: '',
      name: '',
      isEnabled: true,
      trigger: { type: 'taskCreated' },
      conditions: [],
      actions: [],
    });
    setIsEditorOpen(true);
  };

  const handleSave = async (rule: AutomationRule) => {
    // If it's a new rule, generate ID here or let backend do it.
    // Backend (RuleRegistry) expects ID for updates, but for new rules it pushes.
    // However, RuleRegistry logic is: if index != -1 update, else push.
    // So we should probably generate ID here if it's missing, to ensure uniqueness.
    const ruleToSave = rule.id ? rule : { ...rule, id: Math.random().toString(36).substr(2, 9) };

    await sendMessage('saveRule', ruleToSave);
    await fetchRules();
    setIsEditorOpen(false);
    setEditingRule(null);
  };

  const handleDelete = async (rule: AutomationRule) => {
    if (confirm(`Are you sure you want to delete "${rule.name}"?`)) {
      await sendMessage('deleteRule', { id: rule.id });
      await fetchRules();
      setIsEditorOpen(false);
      setEditingRule(null);
    }
  };

  const handleToggleStatus = async (rule: AutomationRule) => {
    await sendMessage('toggleRuleStatus', { id: rule.id, isEnabled: !rule.isEnabled });
    await fetchRules();
  };

  const handleExport = () => {
    exportRules(rules());
  };

  const handleImport = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        const rulesToImport = Array.isArray(json) ? json : [json];

        const validRules: AutomationRule[] = [];
        const invalidRules: any[] = [];

        for (const rule of rulesToImport) {
          if (validateRule(rule)) {
            validRules.push(rule);
          } else {
            invalidRules.push(rule);
          }
        }

        if (invalidRules.length > 0) {
          console.warn(`Skipping ${invalidRules.length} invalid rules during import.`);
        }

        for (const rule of validRules) {
          // Always generate a new ID to ensure we add to existing rules instead of overwriting
          const ruleToSave = { ...rule, id: Math.random().toString(36).substr(2, 9) };
          await sendMessage('saveRule', ruleToSave);
        }
        await fetchRules();

        if (validRules.length > 0) {
          let msg = `Successfully imported ${validRules.length} rules.`;
          if (invalidRules.length > 0) {
            msg += ` (${invalidRules.length} rules were skipped due to invalid format)`;
          }
          alert(msg);
        } else if (invalidRules.length > 0) {
          alert('No valid rules found to import.');
        }
      } catch (err) {
        console.error('Import failed:', err);
        alert('Failed to import rules. Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div class="app">
      <main>
        {isLoading() ? (
          <p>Loading...</p>
        ) : (
          <>
            <RuleList
              rules={rules()}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleStatus={handleToggleStatus}
              onCreate={handleCreate}
              onExport={handleExport}
              onImport={handleImport}
            />
            {editingRule() && (
              <RuleEditor
                isOpen={isEditorOpen()}
                rule={editingRule()!}
                projects={projects()}
                tags={tags()}
                onSave={handleSave}
                onDelete={handleDelete}
                onCancel={() => {
                  setIsEditorOpen(false);
                  setEditingRule(null);
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
