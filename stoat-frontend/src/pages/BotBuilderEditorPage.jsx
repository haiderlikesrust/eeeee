import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { generateBotCode } from '../utils/botCodeGenerator';
import './BotBuilderEditorPage.css';

const TRIGGER_TYPES = [
  { value: 'member_join', label: 'Member joins server' },
  { value: 'command', label: 'User runs command' },
  { value: 'keyword', label: 'Message contains keyword' },
];

function EmbedEditor({ embed, onChange }) {
  const update = (key, value) => onChange({ ...embed, [key]: value });
  const updateField = (index, key, value) => {
    const fields = [...(embed.fields || [])];
    if (!fields[index]) fields[index] = { name: '', value: '', inline: false };
    fields[index] = { ...fields[index], [key]: value };
    onChange({ ...embed, fields });
  };
  const addField = () => onChange({ ...embed, fields: [...(embed.fields || []), { name: '', value: '', inline: false }] });
  const removeField = (index) => {
    const fields = (embed.fields || []).filter((_, i) => i !== index);
    onChange({ ...embed, fields });
  };

  return (
    <div className="builder-embed-editor">
      <label className="builder-field">
        <span>Embed title</span>
        <input
          type="text"
          placeholder="Title"
          value={embed.title || ''}
          onChange={(e) => update('title', e.target.value)}
        />
      </label>
      <label className="builder-field">
        <span>Embed description</span>
        <textarea
          placeholder="Description (supports $user for mentions)"
          value={embed.description || ''}
          onChange={(e) => update('description', e.target.value)}
          rows={2}
          className="builder-embed-textarea"
        />
      </label>
      <label className="builder-field">
        <span>Color (hex)</span>
        <div className="builder-color-row">
          <input
            type="color"
            value={/^#?[0-9a-fA-F]{6}$/.test(String(embed.color || '').replace(/^#/, '')) ? `#${String(embed.color).replace(/^#/, '').slice(0, 6)}` : '#5865f2'}
            onChange={(e) => update('color', e.target.value)}
            className="builder-color-picker"
          />
          <input
            type="text"
            placeholder="#5865f2"
            value={embed.color || ''}
            onChange={(e) => update('color', e.target.value)}
            className="builder-color-hex"
          />
        </div>
      </label>
      <div className="builder-embed-fields">
        <div className="builder-embed-fields-header">
          <span>Fields</span>
          <button type="button" className="builder-add-field-btn" onClick={addField}>+ Add field</button>
        </div>
        {(embed.fields || []).map((f, i) => (
          <div key={i} className="builder-embed-field-row">
            <input
              type="text"
              placeholder="Name"
              value={f.name || ''}
              onChange={(e) => updateField(i, 'name', e.target.value)}
            />
            <input
              type="text"
              placeholder="Value"
              value={f.value || ''}
              onChange={(e) => updateField(i, 'value', e.target.value)}
            />
            <label className="builder-field-row">
              <input
                type="checkbox"
                checked={!!f.inline}
                onChange={(e) => updateField(i, 'inline', e.target.checked)}
              />
              <span>Inline</span>
            </label>
            <button type="button" className="builder-remove-field-btn" onClick={() => removeField(i)} title="Remove">×</button>
          </div>
        ))}
      </div>
      <label className="builder-field">
        <span>Footer (optional)</span>
        <input
          type="text"
          placeholder="Footer text"
          value={embed.footer || ''}
          onChange={(e) => update('footer', e.target.value)}
        />
      </label>
      <label className="builder-field">
        <span>Image URL (optional)</span>
        <input
          type="text"
          placeholder="https://..."
          value={embed.imageUrl || ''}
          onChange={(e) => update('imageUrl', e.target.value)}
        />
      </label>
    </div>
  );
}

const RESPONSE_TYPE = { text: 'Plain text', embed: 'Embed' };

const DEFAULT_EMBED = () => ({
  title: '',
  description: '',
  color: '#5865f2',
  fields: [],
  footer: '',
  imageUrl: '',
});

const DEFAULT_RULE = {
  id: crypto.randomUUID?.() ?? `r${Date.now()}`,
  trigger: { type: 'command', commandName: 'ping', response: 'Pong!', responseType: 'text' },
  actions: [{ type: 'reply', content: 'Pong!' }],
};

function RuleCard({ rule, onChange, onRemove }) {
  const trigger = rule.trigger || {};
  const updateTrigger = (key, value) => {
    onChange({
      ...rule,
      trigger: { ...trigger, [key]: value },
    });
  };

  return (
    <div className="builder-rule-card">
      <div className="builder-rule-header">
        <span className="builder-rule-title">
          {trigger.type === 'member_join' && 'When someone joins'}
          {trigger.type === 'command' && `Command !${trigger.commandName || 'cmd'}`}
          {trigger.type === 'keyword' && `Keyword "${trigger.keyword || '...'}"`}
        </span>
        <button type="button" className="builder-rule-remove" onClick={onRemove} title="Remove rule">
          ×
        </button>
      </div>
      <div className="builder-rule-body">
        <label className="builder-field">
          <span>Trigger</span>
          <select
            value={trigger.type || 'command'}
            onChange={(e) => updateTrigger('type', e.target.value)}
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        {trigger.type === 'member_join' && (
          <>
            <label className="builder-field">
              <span>Welcome channel ID</span>
              <input
                type="text"
                placeholder="Channel ID or set WELCOME_CHANNEL_ID env"
                value={trigger.channelId || ''}
                onChange={(e) => updateTrigger('channelId', e.target.value)}
              />
            </label>
            <label className="builder-field">
              <span>Response type</span>
              <select
                value={trigger.responseType || 'text'}
                onChange={(e) => {
                  const v = e.target.value;
                  updateTrigger('responseType', v);
                  if (v === 'embed' && !trigger.responseEmbed) updateTrigger('responseEmbed', DEFAULT_EMBED());
                }}
              >
                {Object.entries(RESPONSE_TYPE).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            {(trigger.responseType || 'text') === 'text' && (
              <label className="builder-field">
                <span>Welcome message (use $user for mention)</span>
                <input
                  type="text"
                  placeholder="Welcome $user!"
                  value={trigger.messageTemplate || ''}
                  onChange={(e) => updateTrigger('messageTemplate', e.target.value)}
                />
              </label>
            )}
            {(trigger.responseType === 'embed') && (
              <EmbedEditor
                embed={trigger.responseEmbed || DEFAULT_EMBED()}
                onChange={(responseEmbed) => updateTrigger('responseEmbed', responseEmbed)}
              />
            )}
          </>
        )}

        {trigger.type === 'command' && (
          <>
            <label className="builder-field">
              <span>Command name (no prefix)</span>
              <input
                type="text"
                placeholder="ping"
                value={trigger.commandName || ''}
                onChange={(e) => updateTrigger('commandName', e.target.value)}
              />
            </label>
            <label className="builder-field">
              <span>Response type</span>
              <select
                value={trigger.responseType || 'text'}
                onChange={(e) => {
                  const v = e.target.value;
                  updateTrigger('responseType', v);
                  if (v === 'embed' && !trigger.responseEmbed) updateTrigger('responseEmbed', DEFAULT_EMBED());
                }}
              >
                {Object.entries(RESPONSE_TYPE).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            {(trigger.responseType || 'text') === 'text' && (
              <label className="builder-field">
                <span>Response</span>
                <input
                  type="text"
                  placeholder="Pong!"
                  value={trigger.response ?? (rule.actions?.[0]?.content) ?? ''}
                  onChange={(e) => {
                    updateTrigger('response', e.target.value);
                    onChange({
                      ...rule,
                      trigger: { ...trigger, response: e.target.value },
                      actions: [{ type: 'reply', content: e.target.value }],
                    });
                  }}
                />
              </label>
            )}
            {(trigger.responseType === 'embed') && (
              <EmbedEditor
                embed={trigger.responseEmbed || DEFAULT_EMBED()}
                onChange={(responseEmbed) => updateTrigger('responseEmbed', responseEmbed)}
              />
            )}
          </>
        )}

        {trigger.type === 'keyword' && (
          <>
            <label className="builder-field">
              <span>Keyword</span>
              <input
                type="text"
                placeholder="hello"
                value={trigger.keyword || ''}
                onChange={(e) => updateTrigger('keyword', e.target.value)}
              />
            </label>
            <label className="builder-field">
              <span>Response type</span>
              <select
                value={trigger.responseType || 'text'}
                onChange={(e) => {
                  const v = e.target.value;
                  updateTrigger('responseType', v);
                  if (v === 'embed' && !trigger.responseEmbed) updateTrigger('responseEmbed', DEFAULT_EMBED());
                }}
              >
                {Object.entries(RESPONSE_TYPE).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </label>
            {(trigger.responseType || 'text') === 'text' && (
              <label className="builder-field">
                <span>Response</span>
                <input
                  type="text"
                  placeholder="Hi there!"
                  value={trigger.response ?? (rule.actions?.[0]?.content) ?? ''}
                  onChange={(e) => {
                    updateTrigger('response', e.target.value);
                    onChange({
                      ...rule,
                      trigger: { ...trigger, response: e.target.value },
                      actions: [{ type: 'reply', content: e.target.value }],
                    });
                  }}
                />
              </label>
            )}
            {(trigger.responseType === 'embed') && (
              <EmbedEditor
                embed={trigger.responseEmbed || DEFAULT_EMBED()}
                onChange={(responseEmbed) => updateTrigger('responseEmbed', responseEmbed)}
              />
            )}
            <label className="builder-field builder-field-row">
              <input
                type="checkbox"
                checked={!!trigger.caseSensitive}
                onChange={(e) => updateTrigger('caseSensitive', e.target.checked)}
              />
              <span>Case sensitive</span>
            </label>
          </>
        )}
      </div>
    </div>
  );
}

export default function BotBuilderEditorPage() {
  const [rules, setRules] = useState([{ ...DEFAULT_RULE, id: crypto.randomUUID?.() ?? 'r1' }]);
  const [prefix, setPrefix] = useState('!');
  const [baseUrl, setBaseUrl] = useState('http://localhost:14702');
  const [generatedCode, setGeneratedCode] = useState('');
  const [activeTab, setActiveTab] = useState('builder'); // 'builder' | 'code'
  const [copied, setCopied] = useState(false);

  const updateRule = useCallback((index, updated) => {
    setRules((prev) => {
      const next = [...prev];
      next[index] = { ...updated, id: updated.id || next[index].id };
      return next;
    });
  }, []);

  const addRule = useCallback(() => {
    setRules((prev) => [
      ...prev,
      {
        id: crypto.randomUUID?.() ?? `r${Date.now()}`,
        trigger: { type: 'command', commandName: 'help', response: 'I am a bot!' },
        actions: [{ type: 'reply', content: 'I am a bot!' }],
      },
    ]);
  }, []);

  const removeRule = useCallback((index) => {
    setRules((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  const handleGenerate = useCallback(() => {
    const code = generateBotCode(rules, { prefix, baseUrl });
    setGeneratedCode(code);
    setActiveTab('code');
  }, [rules, prefix, baseUrl]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [generatedCode]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([generatedCode], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bot.js';
    a.click();
    URL.revokeObjectURL(url);
  }, [generatedCode]);

  return (
    <div className="builder-page">
      <header className="builder-header">
        <div className="builder-header-inner">
          <Link to="/developers/apps" className="builder-back">← Developer Portal</Link>
          <h1>No-Code Bot Builder</h1>
          <p>Configure triggers and actions, then generate JavaScript you can host.</p>
        </div>
      </header>

      <div className="builder-tabs">
        <button
          type="button"
          className={activeTab === 'builder' ? 'active' : ''}
          onClick={() => setActiveTab('builder')}
        >
          Builder
        </button>
        <button
          type="button"
          className={activeTab === 'code' ? 'active' : ''}
          onClick={() => setActiveTab('code')}
          disabled={!generatedCode}
        >
          Generated Code
        </button>
      </div>

      <div className="builder-content">
        {activeTab === 'builder' && (
          <div className="builder-panel">
            <div className="builder-options">
              <label className="builder-field">
                <span>Command prefix</span>
                <input
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="!"
                />
              </label>
              <label className="builder-field">
                <span>API base URL</span>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://localhost:14702"
                />
              </label>
            </div>

            <div className="builder-rules-header">
              <h2>Rules</h2>
              <button type="button" className="builder-add-rule" onClick={addRule}>
                + Add rule
              </button>
            </div>

            <div className="builder-rules-list">
              {rules.map((rule, index) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onChange={(updated) => updateRule(index, updated)}
                  onRemove={() => removeRule(index)}
                />
              ))}
            </div>

            <div className="builder-actions">
              <button type="button" className="builder-generate-btn" onClick={handleGenerate}>
                Generate JavaScript
              </button>
            </div>
          </div>
        )}

        {activeTab === 'code' && (
          <div className="builder-code-panel">
            <div className="builder-code-actions">
              <button type="button" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button type="button" className="primary" onClick={handleDownload}>
                Download bot.js
              </button>
            </div>
            <pre className="builder-code-output">
              <code>{generatedCode || '// Click "Generate JavaScript" in the Builder tab'}</code>
            </pre>
            <p className="builder-code-hint">
              Run with: <code>BOT_TOKEN=your_token node bot.js</code>. Install dependencies: <code>npm install stoat-bot-sdk</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
