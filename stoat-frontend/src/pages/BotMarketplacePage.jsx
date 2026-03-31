import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import './BotMarketplacePage.css';

export default function BotMarketplacePage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');
  const [servers, setServers] = useState([]);
  const [selectedServerByBot, setSelectedServerByBot] = useState({});
  const [installingBotId, setInstallingBotId] = useState('');

  const ownerServers = useMemo(
    () => (servers || []).filter((s) => s?.owner === user?._id),
    [servers, user?._id],
  );

  const loadMarketplace = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        limit: '48',
        sort,
      });
      if (q.trim()) query.set('q', q.trim());
      const res = await get(`/bots/marketplace?${query.toString()}`);
      setBots(Array.isArray(res?.bots) ? res.bots : []);
    } catch (err) {
      toast.error(err?.error || 'Failed to load bot marketplace');
      setBots([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadMarketplace();
  }, [sort]);

  useEffect(() => {
    const t = setTimeout(() => { loadMarketplace(); }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!user?._id) return;
    get('/users/servers').then((res) => setServers(Array.isArray(res) ? res : [])).catch(() => setServers([]));
  }, [user?._id]);

  const installBot = async (botId) => {
    if (!user?._id) {
      navigate('/login');
      return;
    }
    const serverId = selectedServerByBot[botId] || ownerServers[0]?._id || '';
    if (!serverId) {
      toast.error('Select a server you own');
      return;
    }
    setInstallingBotId(botId);
    try {
      await post(`/bots/${botId}/invite`, { server: serverId });
      toast.success('Bot added to server');
    } catch (err) {
      toast.error(err?.error || 'Failed to add bot');
    }
    setInstallingBotId('');
  };

  return (
    <div className="bot-marketplace-page">
      <div className="bot-marketplace-inner">
        <header className="bot-marketplace-header">
          <div>
            <h1>Bot Marketplace</h1>
            <p>Discover public bots and install them to your server.</p>
          </div>
          <div className="bot-marketplace-nav">
            {user ? (
              <>
                <Link to="/developers/docs/api" className="bot-marketplace-link">Developer Portal</Link>
                <Link to="/channels/@me" className="bot-marketplace-link primary">Back to App</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="bot-marketplace-link">Log in</Link>
                <Link to="/register" className="bot-marketplace-link primary">Sign up</Link>
              </>
            )}
          </div>
        </header>

        <section className="bot-marketplace-controls">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bots by name or bio..."
            className="bot-marketplace-search"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="bot-marketplace-sort">
            <option value="popular">Most Installed</option>
            <option value="new">Newest</option>
          </select>
        </section>

        {loading ? (
          <p className="bot-marketplace-empty">Loading bots...</p>
        ) : bots.length === 0 ? (
          <p className="bot-marketplace-empty">No bots found</p>
        ) : (
          <div className="bot-marketplace-grid">
            {bots.map((bot) => {
              const avatarUrl = resolveFileUrl(bot.user?.avatar);
              return (
                <article key={bot._id} className="bot-marketplace-card">
                  <div className="bot-marketplace-card-head">
                    <div className="bot-marketplace-avatar">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" />
                      ) : (
                        (bot.user?.display_name || bot.user?.username || 'B')[0]?.toUpperCase()
                      )}
                    </div>
                    <div className="bot-marketplace-meta">
                      <h2>{bot.user?.display_name || bot.user?.username || 'Bot'}</h2>
                      <p>{bot.user?.username || 'bot'}</p>
                    </div>
                  </div>
                  <p className="bot-marketplace-bio">
                    {bot.user?.profile?.content || bot.user?.profile?.bio || 'No description provided.'}
                  </p>
                  <div className="bot-marketplace-stats">
                    <span>{bot.installed_count || 0} installs</span>
                    <span>{bot.slash_command_count || 0} slash commands</span>
                  </div>
                  <div className="bot-marketplace-actions">
                    {user ? (
                      <>
                        <select
                          value={selectedServerByBot[bot._id] || ownerServers[0]?._id || ''}
                          onChange={(e) => setSelectedServerByBot((prev) => ({ ...prev, [bot._id]: e.target.value }))}
                          disabled={ownerServers.length === 0}
                        >
                          {ownerServers.length === 0 ? (
                            <option value="">No owned servers</option>
                          ) : (
                            ownerServers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)
                          )}
                        </select>
                        <button
                          type="button"
                          onClick={() => installBot(bot._id)}
                          disabled={ownerServers.length === 0 || installingBotId === bot._id}
                        >
                          {installingBotId === bot._id ? 'Installing...' : 'Add to Server'}
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => navigate('/login')}>Log in to install</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

