import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, post } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import BotCard from './developer/BotCard';
import { getPresenceCurlSnippet, INTENTS, NODE_PRESENCE_SNIPPET } from './developer/constants';
import './DeveloperPortalPage.css';

export default function DeveloperApplicationsPage() {
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
      toast.error(err?.error || 'Failed to load developer applications');
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

  const curlSnippet = getPresenceCurlSnippet(typeof window !== 'undefined' ? window.location.origin : '');

  return (
    <>
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
        <p className="dev-panel-note">
          For endpoint details and interaction format, see the <Link to="/developers/docs/bots">Bots docs</Link>.
        </p>
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
        <h2>Presence token tools</h2>
        <p>
          Manage your personal token here, then use it with the Presence API.
          Full API details are in the <Link to="/developers/docs/api">API docs</Link>.
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
        <pre className="dev-code">{curlSnippet}</pre>
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

      <section className="dev-panel">
        <h2>Node heartbeat example</h2>
        <pre className="dev-code">{NODE_PRESENCE_SNIPPET}</pre>
      </section>
    </>
  );
}
