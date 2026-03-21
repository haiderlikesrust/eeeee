import { useEffect, useMemo, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { del, get, patch, post, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import './DeveloperPortalPage.css';

const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

function hasIntent(bits, intent) {
  return (Number(bits || 0) & intent) === intent;
}

function toggleIntent(bits, intent, enabled) {
  const n = Number(bits || 0);
  return enabled ? (n | intent) : (n & ~intent);
}

function BotCard({
  bot,
  ownerServers,
  onUpdated,
  onRefresh,
  onCopyToken,
}) {
  const toast = useToast();
  const [name, setName] = useState(bot?.user?.username || '');
  const [isPublic, setIsPublic] = useState(!!bot.public);
  const [discoverable, setDiscoverable] = useState(!!bot.discoverable);
  const [analytics, setAnalytics] = useState(!!bot.analytics);
  const [intents, setIntents] = useState(Number(bot.intents || 0));
  const [selectedServerId, setSelectedServerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [revealedToken, setRevealedToken] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  useEffect(() => {
    setName(bot?.user?.username || '');
    setIsPublic(!!bot.public);
    setDiscoverable(!!bot.discoverable);
    setAnalytics(!!bot.analytics);
    setIntents(Number(bot.intents || 0));
    setRevealedToken('');
  }, [bot]);

  const avatarUrl = resolveFileUrl(bot?.user?.avatar);
  const bannerUrl = resolveFileUrl(bot?.user?.profile?.banner || bot?.user?.profile?.background);

  const handleAvatarUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const uploaded = await uploadFile(file);
      await patch(`/bots/${bot._id}`, { avatar: uploaded });
      toast.success('Avatar updated');
      onUpdated();
    } catch (err) {
      toast.error(err?.error || 'Failed to update avatar');
    }
    setAvatarUploading(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const handleBannerUpload = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    setBannerUploading(true);
    try {
      const uploaded = await uploadFile(file);
      await patch(`/bots/${bot._id}`, { profile: { banner: uploaded } });
      toast.success('Banner updated');
      onUpdated();
    } catch (err) {
      toast.error(err?.error || 'Failed to update banner');
    }
    setBannerUploading(false);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  const installableServers = useMemo(
    () => ownerServers.filter((s) => s && s._id),
    [ownerServers]
  );

  const saveSettings = async () => {
    setSaving(true);
    try {
      await patch(`/bots/${bot._id}`, {
        name: name?.trim() || bot?.user?.username || 'bot',
        public: isPublic,
        discoverable,
        analytics,
        intents,
      });
      toast.success('Bot settings saved');
      onUpdated();
    } catch (err) {
      toast.error(err?.error || 'Failed to save bot settings');
    }
    setSaving(false);
  };

  const regenerateToken = async () => {
    if (!confirm('Regenerate bot token? Old token will stop working.')) return;
    try {
      await patch(`/bots/${bot._id}`, { remove: 'Token' });
      toast.success('Token regenerated');
      onRefresh();
    } catch (err) {
      toast.error(err?.error || 'Failed to regenerate token');
    }
  };

  const copyText = async (text) => {
    if (navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through to legacy copy path
      }
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  };

  const fetchToken = async () => {
    const res = await get(`/bots/${bot._id}/token`);
    if (!res?.token) throw new Error('No token returned');
    setRevealedToken(res.token);
    onCopyToken(res.token);
    return res.token;
  };

  const revealToken = async () => {
    try {
      await fetchToken();
      toast.success('Token revealed below');
    } catch (err) {
      toast.error(err?.error || err?.message || 'Failed to fetch token');
    }
  };

  const revealAndCopyToken = async () => {
    try {
      const token = await fetchToken();
      const copied = await copyText(token);
      if (copied) {
        toast.success('Bot token copied');
      } else {
        toast.success('Token revealed below');
      }
    } catch (err) {
      toast.error(err?.error || err?.message || 'Failed to fetch token');
    }
  };

  const installToServer = async () => {
    if (!selectedServerId) return;
    setInstalling(true);
    try {
      await post(`/bots/${bot._id}/invite`, { server: selectedServerId });
      toast.success('Bot added to server');
    } catch (err) {
      toast.error(err?.error || 'Failed to add bot to server');
    }
    setInstalling(false);
  };

  return (
    <div className="dev-bot-card">
      <div className="dev-bot-header">
        <div
          className="dev-bot-avatar dev-bot-avatar-editable"
          onClick={() => avatarInputRef.current?.click()}
          title="Change avatar"
        >
          {avatarUrl ? <img src={avatarUrl} alt="" /> : (bot?.user?.username?.[0] || 'B').toUpperCase()}
          {avatarUploading && <span className="dev-bot-avatar-overlay">...</span>}
        </div>
        <input
          type="file"
          accept="image/*"
          ref={avatarInputRef}
          style={{ display: 'none' }}
          onChange={handleAvatarUpload}
        />
        <div className="dev-bot-meta">
          <div className="dev-bot-name">{bot?.user?.username || 'Bot'}</div>
          <div className="dev-bot-id">{bot?._id}</div>
        </div>
      </div>

      <div className="dev-bot-section-label">Profile</div>
      <div className="dev-bot-profile-row">
        <div className="dev-bot-banner-preview" style={bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : {}}>
          {bannerUploading && <span className="dev-bot-banner-overlay">Uploading...</span>}
        </div>
        <div className="dev-bot-banner-actions">
          <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={bannerUploading}>
            {bannerUrl ? 'Change Banner' : 'Upload Banner'}
          </button>
          {bannerUrl && (
            <button
              type="button"
              className="warn"
              onClick={async () => {
                try {
                  await patch(`/bots/${bot._id}`, { profile: { banner: null } });
                  toast.success('Banner removed');
                  onUpdated();
                } catch (err) {
                  toast.error(err?.error || 'Failed to remove banner');
                }
              }}
            >
              Remove Banner
            </button>
          )}
        </div>
        <input
          type="file"
          accept="image/*"
          ref={bannerInputRef}
          style={{ display: 'none' }}
          onChange={handleBannerUpload}
        />
      </div>

      <div className="dev-grid">
        <label>
          <span>Bot Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Intents Bitfield</span>
          <input
            value={String(intents)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setIntents(Number.isFinite(v) ? v : 0);
            }}
          />
        </label>
      </div>

      <div className="dev-bot-section-label">Gateway Intents</div>
      <div className="dev-intents">
        <label><input type="checkbox" checked={hasIntent(intents, INTENTS.GUILDS)} onChange={(e) => setIntents((v) => toggleIntent(v, INTENTS.GUILDS, e.target.checked))} /> GUILDS</label>
        <label><input type="checkbox" checked={hasIntent(intents, INTENTS.GUILD_MEMBERS)} onChange={(e) => setIntents((v) => toggleIntent(v, INTENTS.GUILD_MEMBERS, e.target.checked))} /> GUILD_MEMBERS</label>
        <label><input type="checkbox" checked={hasIntent(intents, INTENTS.GUILD_MESSAGES)} onChange={(e) => setIntents((v) => toggleIntent(v, INTENTS.GUILD_MESSAGES, e.target.checked))} /> GUILD_MESSAGES</label>
        <label><input type="checkbox" checked={hasIntent(intents, INTENTS.MESSAGE_CONTENT)} onChange={(e) => setIntents((v) => toggleIntent(v, INTENTS.MESSAGE_CONTENT, e.target.checked))} /> MESSAGE_CONTENT</label>
      </div>

      <div className="dev-bot-section-label">Settings</div>
      <div className="dev-flags">
        <label><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Public</label>
        <label><input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} /> Discoverable</label>
        <label><input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} /> Analytics</label>
      </div>

      <div className="dev-actions">
        <button className="primary" onClick={saveSettings} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</button>
        <button onClick={revealToken}>Reveal Token</button>
        <button onClick={revealAndCopyToken}>Copy Token</button>
        <button className="warn" onClick={regenerateToken}>Regenerate Token</button>
      </div>

      {revealedToken && (
        <div className="dev-grid" style={{ marginTop: 12 }}>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Bot Token</span>
            <textarea
              value={revealedToken}
              readOnly
              rows={3}
              onFocus={(e) => e.target.select()}
              style={{ width: '100%', resize: 'vertical' }}
            />
          </label>
        </div>
      )}

      <div className="dev-bot-section-label">Install to Server</div>
      <div className="dev-install-row">
        <select value={selectedServerId} onChange={(e) => setSelectedServerId(e.target.value)}>
          <option value="">Select a server you own</option>
          {installableServers.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </select>
        <button onClick={installToServer} disabled={!selectedServerId || installing}>
          {installing ? 'Adding...' : 'Add To Server'}
        </button>
      </div>
    </div>
  );
}

const NODE_PRESENCE_SNIPPET = `// Node: show while running, hide when process exits (no heartbeat)
const TOKEN = process.env.STOAT_PRESENCE_TOKEN;
const base = process.env.STOAT_API || 'http://localhost:14702';
const headers = { Authorization: \`Bearer \${TOKEN}\`, 'Content-Type': 'application/json' };
await fetch(\`\${base}/public/v1/presence\`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    activity: { type: 'Playing', name: 'My App' },
    ttl_seconds: 60,
    presence: 'Online',
  }),
});
const t = setInterval(() => {
  fetch(\`\${base}/public/v1/presence\`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ heartbeat: true, ttl_seconds: 60 }),
  });
}, 30_000);
process.on('SIGINT', async () => {
  clearInterval(t);
  await fetch(\`\${base}/public/v1/presence\`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ activity: null }),
  });
  process.exit(0);
});`;

export default function DeveloperPortalPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [presenceTokenReveal, setPresenceTokenReveal] = useState('');
  const [bots, setBots] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newBotName, setNewBotName] = useState('');
  const [newBotPublic, setNewBotPublic] = useState(false);
  const [newBotDiscoverable, setNewBotDiscoverable] = useState(false);
  const [newBotIntents, setNewBotIntents] = useState(
    INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT
  );
  const [lastCopiedToken, setLastCopiedToken] = useState('');

  const ownerServers = useMemo(
    () => servers.filter((s) => s?.owner === user?._id),
    [servers, user?._id]
  );

  const load = async () => {
    setLoading(true);
    try {
      const [myBots, myServers] = await Promise.all([
        get('/bots/@me'),
        get('/users/servers'),
      ]);
      setBots(Array.isArray(myBots) ? myBots : []);
      setServers(Array.isArray(myServers) ? myServers : []);
    } catch (err) {
      toast.error(err?.error || 'Failed to load developer portal');
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const createBot = async () => {
    if (!newBotName.trim()) return;
    setCreating(true);
    try {
      await post('/bots/create', {
        name: newBotName.trim(),
        public: newBotPublic,
        discoverable: newBotDiscoverable,
        intents: newBotIntents,
      });
      setNewBotName('');
      setNewBotPublic(false);
      setNewBotDiscoverable(false);
      setNewBotIntents(INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT);
      toast.success('Bot created');
      await load();
    } catch (err) {
      toast.error(err?.error || 'Failed to create bot');
    }
    setCreating(false);
  };

  return (
    <div className="dev-portal-page">
      <div className="dev-portal-inner">
        <header className="dev-portal-header">
          <div>
            <h1>Developer Portal</h1>
            <p>Create bots, configure intents, use the rich presence API for your account, install into servers, and test with the SDK.</p>
            <p style={{ marginTop: 6 }}>
              <Link to="/developer/editor" className="dev-link-btn" style={{ marginRight: 8 }}>No-Code Bot Builder</Link>
            </p>
          </div>
          <Link to="/channels/@me" className="dev-link-btn">Back to App</Link>
        </header>

        <section className="dev-panel">
          <h2>Create Bot</h2>
          <div className="dev-grid">
            <label>
              <span>Bot Name</span>
              <input value={newBotName} onChange={(e) => setNewBotName(e.target.value)} placeholder="my-bot" />
            </label>
            <label>
              <span>Intents Bitfield</span>
              <input
                value={String(newBotIntents)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setNewBotIntents(Number.isFinite(v) ? v : 0);
                }}
              />
            </label>
          </div>
          <div className="dev-flags">
            <label><input type="checkbox" checked={newBotPublic} onChange={(e) => setNewBotPublic(e.target.checked)} /> Public</label>
            <label><input type="checkbox" checked={newBotDiscoverable} onChange={(e) => setNewBotDiscoverable(e.target.checked)} /> Discoverable</label>
          </div>
          <button onClick={createBot} disabled={creating || !newBotName.trim()}>
            {creating ? 'Creating...' : 'Create Bot'}
          </button>
        </section>

        <section className="dev-panel">
          <h2>Your Bots</h2>
          {loading ? (
            <p>Loading bots...</p>
          ) : bots.length === 0 ? (
            <p>No bots yet. Create one above.</p>
          ) : (
            <div className="dev-bot-list">
              {bots.map((bot) => (
                <BotCard
                  key={bot._id}
                  bot={bot}
                  ownerServers={ownerServers}
                  onUpdated={load}
                  onRefresh={load}
                  onCopyToken={setLastCopiedToken}
                />
              ))}
            </div>
          )}
        </section>

        <section className="dev-panel dev-presence-panel">
          <h2>Rich presence API</h2>
          <p>
            Playing / listening / streaming activity for <strong>your user account</strong> is set only via HTTP (scripts, desktop apps, etc.).
            Custom status and presence mode from User Settings still apply; this API adds activity and optional lease-based online presence.
          </p>
          <p>
            {user?.presence_api_token_configured
              ? 'A secret token is active on your account.'
              : 'No token yet — create one to enable the API.'}
          </p>
          {presenceTokenReveal ? (
            <label className="dev-presence-token-field">
              <span>New token (copy now)</span>
              <input readOnly value={presenceTokenReveal} onFocus={(e) => e.target.select()} />
            </label>
          ) : null}
          <div className="dev-actions dev-presence-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  const data = await post('/users/@me/presence-token');
                  if (data?.token) {
                    setPresenceTokenReveal(data.token);
                    setUser((prev) => (prev ? { ...prev, presence_api_token_configured: true } : prev));
                    toast.success('Token issued — copy it now');
                  }
                } catch (err) {
                  toast.error(err?.error || err?.message || 'Failed to create token');
                }
              }}
            >
              Create / rotate token
            </button>
            <button
              type="button"
              disabled={!user?.presence_api_token_configured}
              onClick={async () => {
                try {
                  const u = await del('/users/@me/presence-token');
                  setPresenceTokenReveal('');
                  if (u) setUser((prev) => (prev ? { ...prev, ...u } : prev));
                  toast.success('Token revoked');
                } catch (err) {
                  toast.error(err?.error || err?.message || 'Failed to revoke');
                }
              }}
            >
              Revoke token
            </button>
          </div>
          <p>
            Activity uses a time lease (default <code>ttl_seconds: 120</code>). While your script keeps sending updates or{' '}
            <code>heartbeat: true</code> before the lease ends, presence stays; when the script stops, it clears automatically.
          </p>
          <p>
            Elapsed time (e.g. “for 12m”) is computed from <code>started_at</code> (set when the session starts; changing name/details/state starts a new session).
            Optional <code>activity.image</code>: an <code>https://</code> URL or an attachment object from <code>POST /attachments</code> (same shape as avatar uploads).
          </p>
          <p>While the lease is active, you count as online in member lists even if no browser tab is connected.</p>
          <pre className="dev-code">{NODE_PRESENCE_SNIPPET}</pre>
          <pre className="dev-code">
            {`curl -X PATCH "${typeof window !== 'undefined' ? window.location.origin : ''}/api/public/v1/presence" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"activity":{"type":"Playing","name":"My Game"},"ttl_seconds":120}'`}
          </pre>
          <p>
            Clear immediately: <code>{'{"activity":null}'}</code>. Optional <code>presence</code> (Online, Idle, Busy, Invisible).
          </p>
        </section>

        <section className="dev-panel">
          <h2>SDK Quick Test</h2>
          <p>After copying the bot token, run this from your <code>stoat-bot-sdk</code> folder:</p>
          <pre className="dev-code">BOT_TOKEN=your_token_here node examples/ping-bot.js</pre>
          <p>Then in any text channel where the bot is a member, send <code>!ping</code> and the bot will reply <code>pong</code>.</p>
          {lastCopiedToken && (
            <>
              <p>Last copied token:</p>
              <pre className="dev-code">{`${String(lastCopiedToken).slice(0, 8)}${'•'.repeat(20)}${String(lastCopiedToken).slice(-6)}`}</pre>
            </>
          )}
        </section>

        <section className="dev-panel dev-deploy-panel">
          <h2>Deploy</h2>
          <p>Host your bot in the cloud and keep it running 24/7.</p>
          <a
            href="https://railway.app"
            target="_blank"
            rel="noopener noreferrer"
            className="dev-deploy-link"
          >
            <span className="dev-deploy-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24"><use href="/icons.svg#railway-icon" /></svg>
            </span>
            Deploy on Railway
          </a>
        </section>
      </div>
    </div>
  );
}
