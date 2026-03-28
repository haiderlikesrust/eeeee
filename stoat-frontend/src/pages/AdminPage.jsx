import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveFileUrl } from '../utils/avatarUrl';
import { clearSystemBadgeCache } from '../utils/systemBadges';
import { OPIC_STAFF_BADGE_ID, userHasOpicStaff } from '../utils/opicStaff';
import { useToast } from '../context/ToastContext';
import './AdminPage.css';

const ADMIN_TOKEN_KEY = 'admin_token';

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function setAdminToken(token) {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
}

async function adminFetch(path, { method = 'GET', body, token, isForm = false } = {}) {
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  if (token) headers['x-admin-token'] = token;
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
  });
  if (res.status === 204) return null;
  let data = null;
  let text = '';
  try {
    data = await res.json();
  } catch {
    text = await res.text().catch(() => '');
  }
  if (!res.ok) {
    throw data || { error: (text || `Request failed (${res.status})`).trim() };
  }
  return data;
}

export default function AdminPage() {
  const toast = useToast();
  const [token, setToken] = useState(getAdminToken());
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [badges, setBadges] = useState([]);
  const [loadingBadges, setLoadingBadges] = useState(false);

  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIcon, setNewIcon] = useState(null);
  const [creatingBadge, setCreatingBadge] = useState(false);

  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [userBadgeDrafts, setUserBadgeDrafts] = useState({});
  const [searchingUsers, setSearchingUsers] = useState(false);

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState('');

  const [activeTab, setActiveTab] = useState('overview');

  const [officialClawId, setOfficialClawId] = useState('');
  const [clawUser, setClawUser] = useState(null);
  const [clawDraft, setClawDraft] = useState({
    display_name: '',
    username: '',
    discriminator: '',
    bio: '',
  });
  const [loadingClaw, setLoadingClaw] = useState(false);
  const [savingClaw, setSavingClaw] = useState(false);
  const [clawChannelId, setClawChannelId] = useState('');
  const [clawMessageContent, setClawMessageContent] = useState('');
  const [sendingClawMsg, setSendingClawMsg] = useState(false);
  const [userDisableReasonDraft, setUserDisableReasonDraft] = useState({});

  const [staffQuery, setStaffQuery] = useState('');
  const [staffResults, setStaffResults] = useState([]);
  const [searchingStaff, setSearchingStaff] = useState(false);

  const [reportList, setReportList] = useState([]);
  const [reportTotal, setReportTotal] = useState(0);
  const [loadingReports, setLoadingReports] = useState(false);
  const [reportDetailById, setReportDetailById] = useState({});
  const [expandedReportId, setExpandedReportId] = useState(null);

  const [publicServersPending, setPublicServersPending] = useState([]);
  const [loadingPublicServers, setLoadingPublicServers] = useState(false);
  const [publicApproveSlugDraft, setPublicApproveSlugDraft] = useState({});

  const activeBadges = useMemo(() => badges.filter((b) => b.active), [badges]);

  const tabs = useMemo(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'claw', label: 'Claw' },
      { id: 'badges', label: 'Badges' },
      { id: 'staff', label: 'Staff' },
      { id: 'users', label: 'Users' },
      { id: 'moderation', label: 'Moderation' },
      { id: 'public-servers', label: 'Public servers' },
    ],
    [],
  );

  const statCards = useMemo(
    () => [
      { key: 'users', label: 'Users' },
      { key: 'bot_users', label: 'Bot users' },
      { key: 'servers', label: 'Servers' },
      { key: 'channels', label: 'Channels' },
      { key: 'messages', label: 'Messages' },
      { key: 'reports', label: 'Reports' },
      { key: 'members', label: 'Member rows' },
      { key: 'invites', label: 'Invites' },
      { key: 'webhooks', label: 'Webhooks' },
      { key: 'bot_apps', label: 'Bot apps' },
      { key: 'global_badges', label: 'Global badges' },
      { key: 'active_badges', label: 'Active badges' },
    ],
    [],
  );

  useEffect(() => {
    const boot = async () => {
      if (!token) {
        setChecking(false);
        return;
      }
      try {
        const meRes = await adminFetch('/me', { token });
        setMe(meRes);
        await loadBadges(token);
        await loadStats(token);
      } catch {
        setAdminToken('');
        setToken('');
        setMe(null);
      }
      setChecking(false);
    };
    boot();
  }, []);

  useEffect(() => {
    if (!token || !me) return;
    adminFetch('/claw', { token })
      .then((d) => {
        if (d?.user?._id) setOfficialClawId(d.user._id);
      })
      .catch(() => {});
  }, [token, me]);

  useEffect(() => {
    if (!token || !me || activeTab !== 'moderation') return;
    loadReportList();
  }, [activeTab, token, me]);

  useEffect(() => {
    if (!token || !me || activeTab !== 'public-servers') return;
    loadPublicServers();
  }, [activeTab, token, me]);

  useEffect(() => {
    if (!token || !me || activeTab !== 'claw') return;
    loadClaw();
  }, [activeTab, token, me]);

  async function loadClaw() {
    setLoadingClaw(true);
    try {
      const data = await adminFetch('/claw', { token });
      const u = data?.user;
      setClawUser(u || null);
      if (u?._id) setOfficialClawId(u._id);
      if (u) {
        setClawDraft({
          display_name: u.display_name || '',
          username: u.username || '',
          discriminator: u.discriminator || '',
          bio: u.profile?.bio || '',
        });
      }
    } catch (err) {
      toast.error(err?.error || 'Failed to load Claw');
      setClawUser(null);
    }
    setLoadingClaw(false);
  }

  async function saveClawProfile() {
    if (!clawDraft.username.trim()) {
      toast.error('Username is required');
      return;
    }
    setSavingClaw(true);
    try {
      const data = await adminFetch('/claw', {
        method: 'PATCH',
        token,
        body: {
          display_name: clawDraft.display_name.trim() || null,
          username: clawDraft.username.trim(),
          discriminator: clawDraft.discriminator.trim() || '0000',
          profile: { bio: clawDraft.bio.trim() || null },
        },
      });
      const u = data?.user;
      if (u) {
        setClawUser(u);
        toast.success('Claw profile updated');
      }
    } catch (err) {
      toast.error(err?.error || 'Failed to save Claw');
    }
    setSavingClaw(false);
  }

  async function uploadClawAvatar(file) {
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await adminFetch('/upload', { method: 'POST', body: form, token, isForm: true });
      await adminFetch('/claw', {
        method: 'PATCH',
        token,
        body: { avatar: uploaded },
      });
      await loadClaw();
      toast.success('Claw avatar updated');
    } catch (err) {
      toast.error(err?.error || 'Avatar upload failed');
    }
  }

  async function sendClawMessage() {
    const cid = clawChannelId.trim();
    const text = clawMessageContent.trim();
    if (!cid || !text) {
      toast.error('Channel ID and message are required');
      return;
    }
    setSendingClawMsg(true);
    try {
      await adminFetch('/claw/messages', {
        method: 'POST',
        token,
        body: { channel_id: cid, content: text },
      });
      setClawMessageContent('');
      toast.success('Message sent as Claw');
    } catch (err) {
      toast.error(err?.error || 'Failed to send message');
    }
    setSendingClawMsg(false);
  }

  async function loadBadges(activeToken = token) {
    setLoadingBadges(true);
    try {
      const list = await adminFetch('/badges', { token: activeToken });
      setBadges(Array.isArray(list) ? list : []);
    } catch (err) {
      toast.error(err?.error || 'Failed to load badges');
    }
    setLoadingBadges(false);
  }

  async function loadStats(activeToken = token) {
    setLoadingStats(true);
    setStatsError('');
    try {
      const data = await adminFetch('/stats', { token: activeToken });
      setStats(data);
    } catch (err) {
      setStats(null);
      setStatsError(err?.error || 'Failed to load stats');
    }
    setLoadingStats(false);
  }

  async function loadReportList(activeToken = token) {
    setLoadingReports(true);
    try {
      const data = await adminFetch('/reports?limit=50', { token: activeToken });
      setReportList(Array.isArray(data?.reports) ? data.reports : []);
      setReportTotal(typeof data?.total === 'number' ? data.total : 0);
    } catch (err) {
      toast.error(err?.error || 'Failed to load reports');
      setReportList([]);
      setReportTotal(0);
    }
    setLoadingReports(false);
  }

  async function loadPublicServers() {
    setLoadingPublicServers(true);
    try {
      const data = await adminFetch('/public-servers/pending', { token });
      setPublicServersPending(Array.isArray(data?.servers) ? data.servers : []);
    } catch (err) {
      toast.error(err?.error || 'Failed to load public server queue');
      setPublicServersPending([]);
    }
    setLoadingPublicServers(false);
  }

  async function approvePublicServer(serverId) {
    const slug = (publicApproveSlugDraft[serverId] || '').trim();
    try {
      await adminFetch(`/public-servers/${serverId}/approve`, {
        method: 'POST',
        token,
        body: slug ? { slug } : {},
      });
      toast.success('Public listing approved');
      setPublicApproveSlugDraft((prev) => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
      await loadPublicServers();
    } catch (err) {
      toast.error(err?.error || 'Approve failed');
    }
  }

  async function rejectPublicServer(serverId) {
    try {
      await adminFetch(`/public-servers/${serverId}/reject`, { method: 'POST', token });
      toast.success('Request rejected');
      setPublicApproveSlugDraft((prev) => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
      await loadPublicServers();
    } catch (err) {
      toast.error(err?.error || 'Reject failed');
    }
  }

  async function toggleReportDetail(reportId) {
    if (expandedReportId === reportId) {
      setExpandedReportId(null);
      return;
    }
    if (!reportDetailById[reportId]) {
      try {
        const detail = await adminFetch(`/reports/${reportId}`, { token });
        setReportDetailById((prev) => ({ ...prev, [reportId]: detail }));
      } catch (err) {
        toast.error(err?.error || 'Failed to load report');
        return;
      }
    }
    setExpandedReportId(reportId);
  }

  async function deleteReport(reportId) {
    if (!confirm('Delete this report permanently?')) return;
    try {
      await adminFetch(`/reports/${reportId}`, { method: 'DELETE', token });
      setReportList((prev) => prev.filter((r) => r.id !== reportId));
      setReportTotal((t) => Math.max(0, t - 1));
      setReportDetailById((prev) => {
        const next = { ...prev };
        delete next[reportId];
        return next;
      });
      if (expandedReportId === reportId) setExpandedReportId(null);
      await loadStats();
      toast.success('Report deleted');
    } catch (err) {
      toast.error(err?.error || 'Failed to delete report');
    }
  }

  async function setUserPrivileged(userId, privileged) {
    try {
      const updated = await adminFetch(`/users/${userId}`, {
        method: 'PATCH',
        token,
        body: { privileged },
      });
      setUserResults((prev) => prev.map((u) => (u._id === userId ? { ...u, ...updated } : u)));
      toast.success(privileged ? 'User marked as privileged' : 'Privileged access removed');
    } catch (err) {
      toast.error(err?.error || 'Failed to update user');
    }
  }

  async function setUserDisabled(userId, disabled) {
    if (userId === officialClawId) {
      toast.error('Cannot disable the official Claw account');
      return;
    }
    try {
      const reason = disabled ? (userDisableReasonDraft[userId] || '').trim() : '';
      const updated = await adminFetch(`/users/${userId}`, {
        method: 'PATCH',
        token,
        body: {
          disabled,
          disabled_reason: disabled ? (reason || null) : null,
        },
      });
      setUserResults((prev) => prev.map((u) => (u._id === userId ? { ...u, ...updated } : u)));
      setUserDisableReasonDraft((prev) => ({
        ...prev,
        [userId]: updated.disabled_reason || '',
      }));
      toast.success(disabled ? 'User disabled — they cannot log in or use the API' : 'User re-enabled');
    } catch (err) {
      toast.error(err?.error || 'Failed to update account status');
    }
  }

  const login = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await adminFetch('/login', { method: 'POST', body: { email, password } });
      setAdminToken(res.token);
      setToken(res.token);
      setMe({
        ...(res.admin || { email }),
        session_expires_at: res.session_expires_at || null,
      });
      await loadBadges(res.token);
      await loadStats(res.token);
      toast.success('Admin login successful');
    } catch (err) {
      setLoginError(err?.error || 'Invalid credentials');
    }
    setLoginLoading(false);
  };

  const logout = async () => {
    try {
      if (token) await adminFetch('/logout', { method: 'POST', token });
    } catch {}
    setAdminToken('');
    setToken('');
    setMe(null);
    setBadges([]);
    setUserResults([]);
    setUserBadgeDrafts({});
    setStats(null);
    setStatsError('');
    setActiveTab('overview');
    setReportList([]);
    setReportTotal(0);
    setReportDetailById({});
    setExpandedReportId(null);
    setPublicServersPending([]);
    setPublicApproveSlugDraft({});
  };

  const uploadBadgeIcon = async (file) => {
    const form = new FormData();
    form.append('file', file);
    const uploaded = await adminFetch('/upload', { method: 'POST', body: form, token, isForm: true });
    return uploaded;
  };

  const createBadge = async () => {
    if (!newId.trim() || !newLabel.trim()) return;
    setCreatingBadge(true);
    try {
      await adminFetch('/badges', {
        method: 'POST',
        token,
        body: {
          id: newId,
          label: newLabel,
          description: newDescription,
          icon: newIcon,
          active: true,
        },
      });
      setNewId('');
      setNewLabel('');
      setNewDescription('');
      setNewIcon(null);
      await loadBadges();
      clearSystemBadgeCache();
      toast.success('Badge created');
    } catch (err) {
      toast.error(err?.error || 'Failed to create badge');
    }
    setCreatingBadge(false);
  };

  const saveBadge = async (badge) => {
    try {
      await adminFetch(`/badges/${badge.id}`, {
        method: 'PATCH',
        token,
        body: {
          label: badge.label,
          description: badge.description || '',
          icon: badge.icon || null,
          active: !!badge.active,
        },
      });
      clearSystemBadgeCache();
      toast.success('Badge updated');
    } catch (err) {
      toast.error(err?.error || 'Failed to update badge');
    }
  };

  async function searchStaffUsers() {
    setSearchingStaff(true);
    try {
      const q = encodeURIComponent(staffQuery.trim());
      const users = await adminFetch(`/users${q ? `?q=${q}` : ''}`, { token });
      setStaffResults(Array.isArray(users) ? users : []);
    } catch (err) {
      toast.error(err?.error || 'Failed to search users');
      setStaffResults([]);
    }
    setSearchingStaff(false);
  }

  async function toggleUserStaff(userId, enabled) {
    const u = staffResults.find((x) => x._id === userId);
    if (!u) return;
    const next = new Set(Array.isArray(u.system_badges) ? u.system_badges : []);
    if (enabled) next.add(OPIC_STAFF_BADGE_ID);
    else next.delete(OPIC_STAFF_BADGE_ID);
    try {
      const updated = await adminFetch(`/users/${userId}/badges`, {
        method: 'PATCH',
        token,
        body: { badges: [...next] },
      });
      setStaffResults((prev) => prev.map((x) => (x._id === userId ? { ...x, system_badges: updated.system_badges || [] } : x)));
      clearSystemBadgeCache();
      toast.success(enabled ? 'User marked as Opic Staff' : 'Opic Staff removed');
    } catch (err) {
      toast.error(err?.error || 'Failed to update staff badge');
    }
  }

  const deleteBadge = async (badgeId) => {
    if (badgeId === OPIC_STAFF_BADGE_ID) {
      toast.error('The Opic Staff badge cannot be deleted');
      return;
    }
    if (!confirm(`Delete badge "${badgeId}"?`)) return;
    try {
      await adminFetch(`/badges/${badgeId}`, { method: 'DELETE', token });
      setBadges((prev) => prev.filter((b) => b.id !== badgeId));
      clearSystemBadgeCache();
      toast.success('Badge deleted');
    } catch (err) {
      toast.error(err?.error || 'Failed to delete badge');
    }
  };

  const searchUsers = async () => {
    setSearchingUsers(true);
    try {
      const q = encodeURIComponent(userQuery.trim());
      const users = await adminFetch(`/users${q ? `?q=${q}` : ''}`, { token });
      setUserResults(Array.isArray(users) ? users : []);
      const draft = {};
      const disableDraft = {};
      (users || []).forEach((u) => {
        draft[u._id] = Array.isArray(u.system_badges) ? u.system_badges : [];
        disableDraft[u._id] = u.disabled_reason || '';
      });
      setUserBadgeDrafts(draft);
      setUserDisableReasonDraft(disableDraft);
    } catch (err) {
      toast.error(err?.error || 'Failed to search users');
    }
    setSearchingUsers(false);
  };

  const toggleUserBadge = (userId, badgeId) => {
    setUserBadgeDrafts((prev) => {
      const current = Array.isArray(prev[userId]) ? prev[userId] : [];
      const has = current.includes(badgeId);
      return {
        ...prev,
        [userId]: has ? current.filter((x) => x !== badgeId) : [...current, badgeId],
      };
    });
  };

  const saveUserBadges = async (userId) => {
    try {
      const badgesForUser = userBadgeDrafts[userId] || [];
      const updated = await adminFetch(`/users/${userId}/badges`, {
        method: 'PATCH',
        token,
        body: { badges: badgesForUser },
      });
      setUserResults((prev) => prev.map((u) => (u._id === userId ? { ...u, system_badges: updated.system_badges || [] } : u)));
      clearSystemBadgeCache();
      toast.success('User badges updated');
    } catch (err) {
      toast.error(err?.error || 'Failed to update user badges');
    }
  };

  if (checking) {
    return <div className="admin-page loading">Checking admin session...</div>;
  }

  if (!token || !me) {
    return (
      <div className="admin-auth-wrap">
        <form className="admin-auth-card" onSubmit={login}>
          <h1>Admin Panel</h1>
          <p>Sign in as app admin</p>
          {loginError && <div className="admin-error">{loginError}</div>}
          <label>
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button type="submit" disabled={loginLoading}>{loginLoading ? 'Logging in...' : 'Login'}</button>
          <Link to="/login" className="admin-back-link">Back to user login</Link>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <h1>Admin Panel</h1>
          <p className="admin-header-email">{me.email}</p>
          {me.session_expires_at && (
            <p className="admin-session-meta">
              Session expires {new Date(me.session_expires_at).toLocaleString()}
            </p>
          )}
        </div>
        <div className="admin-header-actions">
          <Link to="/channels/@me" className="admin-link-btn">Open App</Link>
          <button type="button" onClick={logout} className="admin-danger-btn">Logout</button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`admin-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
      <section className="admin-section admin-overview">
        <div className="admin-overview-head">
          <h2>Overview</h2>
          <div className="admin-overview-head-actions">
            {stats?.generated_at && (
              <span className="admin-stats-generated">Updated {new Date(stats.generated_at).toLocaleString()}</span>
            )}
            <button type="button" onClick={() => loadStats()} disabled={loadingStats} className="admin-link-btn">
              {loadingStats ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {statsError && <div className="admin-error admin-stats-error">{statsError}</div>}
        {loadingStats && !stats ? (
          <p className="admin-stats-loading">Loading stats…</p>
        ) : (
          <>
            <div className="admin-stats-grid">
              {statCards.map(({ key, label }) => (
                <div key={key} className="admin-stat-card">
                  <span className="admin-stat-value">
                    {stats?.counts && typeof stats.counts[key] === 'number'
                      ? stats.counts[key].toLocaleString()
                      : '—'}
                  </span>
                  <span className="admin-stat-label">{label}</span>
                </div>
              ))}
            </div>
            <div className="admin-activity-grid">
              <div className="admin-activity-block">
                <h3>Recent reports</h3>
                {(stats?.recent_reports || []).length === 0 ? (
                  <p className="admin-empty">No reports yet.</p>
                ) : (
                  <div className="admin-mini-table-wrap">
                    <table className="admin-mini-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Reporter</th>
                          <th>Reason</th>
                          <th>Preview</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.recent_reports || []).map((r) => (
                          <tr key={r.id}>
                            <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                            <td>
                              <div>{r.author_display_name || r.author_username || '—'}</div>
                              <code className="admin-id-sub">{r.author_id}</code>
                            </td>
                            <td>{r.reason || '—'}</td>
                            <td className="admin-preview-cell">{r.content_preview || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="admin-activity-block">
                <h3>Recent audit log</h3>
                {(stats?.recent_audit || []).length === 0 ? (
                  <p className="admin-empty">No audit entries yet.</p>
                ) : (
                  <div className="admin-mini-table-wrap">
                    <table className="admin-mini-table">
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Server</th>
                          <th>User</th>
                          <th>Action</th>
                          <th>Target</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.recent_audit || []).map((a) => (
                          <tr key={a.id}>
                            <td>{a.created_at ? new Date(a.created_at).toLocaleString() : '—'}</td>
                            <td>
                              <div>{a.server_name || '—'}</div>
                              <code className="admin-id-sub">{a.server_id}</code>
                            </td>
                            <td><code className="admin-id-sub">{a.user}</code></td>
                            <td>{a.action}</td>
                            <td>
                              <div>{a.target_type || '—'}</div>
                              {a.target_id ? <code className="admin-id-sub">{a.target_id}</code> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
      )}

      {activeTab === 'claw' && (
      <section className="admin-section admin-claw">
        <h2>Official bot — Claw</h2>
        <p className="admin-section-intro">
          Platform bot (like Discord&rsquo;s Clyde). Edit its profile, send announcements to any server text channel by ID, and disable abusive accounts under <strong>Users</strong>.
        </p>
        {loadingClaw && !clawUser ? (
          <p className="admin-stats-loading">Loading Claw…</p>
        ) : clawUser ? (
          <div className="admin-claw-grid">
            <div className="admin-claw-card">
              <h3>Profile</h3>
              <div className="admin-claw-avatar-row">
                {clawUser.avatar?.url || clawUser.avatar?._id ? (
                  <img src={resolveFileUrl(clawUser.avatar)} alt="" className="admin-claw-avatar-preview" />
                ) : (
                  <div className="admin-claw-avatar-placeholder">{(clawUser.display_name || clawUser.username || 'C')[0]}</div>
                )}
                <label className="admin-upload-btn">
                  Change avatar
                  <input
                    type="file"
                    accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) await uploadClawAvatar(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              <label className="admin-claw-field">
                <span>Display name</span>
                <input
                  value={clawDraft.display_name}
                  onChange={(e) => setClawDraft((d) => ({ ...d, display_name: e.target.value }))}
                />
              </label>
              <label className="admin-claw-field">
                <span>Username</span>
                <input
                  value={clawDraft.username}
                  onChange={(e) => setClawDraft((d) => ({ ...d, username: e.target.value }))}
                />
              </label>
              <label className="admin-claw-field">
                <span>Discriminator</span>
                <input
                  value={clawDraft.discriminator}
                  onChange={(e) => setClawDraft((d) => ({ ...d, discriminator: e.target.value }))}
                  maxLength={4}
                />
              </label>
              <label className="admin-claw-field">
                <span>Bio</span>
                <textarea
                  rows={3}
                  value={clawDraft.bio}
                  onChange={(e) => setClawDraft((d) => ({ ...d, bio: e.target.value }))}
                />
              </label>
              <button type="button" className="admin-primary-btn" onClick={saveClawProfile} disabled={savingClaw}>
                {savingClaw ? 'Saving…' : 'Save profile'}
              </button>
              <p className="admin-claw-meta">
                <code>User id:</code> {clawUser._id}
                {clawUser.verified_bot && <span className="admin-claw-verified-pill">Verified bot</span>}
              </p>
            </div>
            <div className="admin-claw-card">
              <h3>Send as Claw</h3>
              <p className="admin-claw-hint">
                Posts in a server text channel or thread without Claw being a member. Use the channel id from the URL or API.
              </p>
              <label className="admin-claw-field">
                <span>Channel ID</span>
                <input
                  placeholder="e.g. 01HQ…"
                  value={clawChannelId}
                  onChange={(e) => setClawChannelId(e.target.value)}
                />
              </label>
              <label className="admin-claw-field">
                <span>Message</span>
                <textarea
                  rows={4}
                  placeholder="Announcement text…"
                  value={clawMessageContent}
                  onChange={(e) => setClawMessageContent(e.target.value)}
                />
              </label>
              <button type="button" className="admin-primary-btn" onClick={sendClawMessage} disabled={sendingClawMsg}>
                {sendingClawMsg ? 'Sending…' : 'Send message'}
              </button>
            </div>
          </div>
        ) : (
          <p className="admin-empty">Could not load Claw.</p>
        )}
      </section>
      )}

      {activeTab === 'badges' && (
      <section className="admin-section">
        <h2>Global Badge Catalog</h2>
        <div className="admin-create-badge">
          <input placeholder="badge_id" value={newId} onChange={(e) => setNewId(e.target.value)} />
          <input placeholder="Label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <input placeholder="Description (optional)" value={newDescription} onChange={(e) => setNewDescription(e.target.value)} />
          <label className="admin-upload-btn">
            Upload PNG
            <input
              type="file"
              accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const uploaded = await uploadBadgeIcon(f);
                  setNewIcon(uploaded);
                  toast.success('Badge icon uploaded');
                } catch (err) {
                  toast.error(err?.error || 'Upload failed');
                }
                e.target.value = '';
              }}
            />
          </label>
          <button onClick={createBadge} disabled={creatingBadge}>{creatingBadge ? 'Creating...' : 'Create Badge'}</button>
        </div>
        {newIcon?.url && (
          <div className="admin-upload-preview">
            <img src={resolveFileUrl(newIcon)} alt="" />
            <span>{newIcon.filename || 'Uploaded icon'}</span>
          </div>
        )}

        {loadingBadges ? <p>Loading badges...</p> : (
          <div className="admin-badge-list">
            {badges.map((badge) => (
              <div className="admin-badge-item" key={badge.id}>
                <div className="admin-badge-icon">
                  {badge.icon?.url ? <img src={resolveFileUrl(badge.icon)} alt="" /> : <span>🏷️</span>}
                </div>
                <div className="admin-badge-fields">
                  <div className="admin-badge-id">
                    {badge.id}
                    {badge.id === OPIC_STAFF_BADGE_ID && (
                      <span className="admin-badge-reserved" title="Created automatically; assign users in Staff tab">Reserved</span>
                    )}
                  </div>
                  <input
                    value={badge.label}
                    onChange={(e) => setBadges((prev) => prev.map((b) => b.id === badge.id ? { ...b, label: e.target.value } : b))}
                  />
                  <input
                    value={badge.description || ''}
                    onChange={(e) => setBadges((prev) => prev.map((b) => b.id === badge.id ? { ...b, description: e.target.value } : b))}
                  />
                </div>
                <div className="admin-badge-actions">
                  <label className="admin-upload-btn small">
                    Icon
                    <input
                      type="file"
                      accept="image/png,image/webp,image/gif,image/jpeg,image/svg+xml"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        try {
                          const uploaded = await uploadBadgeIcon(f);
                          setBadges((prev) => prev.map((b) => b.id === badge.id ? { ...b, icon: uploaded } : b));
                          toast.success('Icon uploaded');
                        } catch (err) {
                          toast.error(err?.error || 'Upload failed');
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <label className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={badge.active !== false}
                      disabled={badge.id === OPIC_STAFF_BADGE_ID}
                      onChange={(e) => setBadges((prev) => prev.map((b) => b.id === badge.id ? { ...b, active: e.target.checked } : b))}
                    />
                    Active
                  </label>
                  <button onClick={() => saveBadge(badge)}>Save</button>
                  <button
                    type="button"
                    className="admin-danger-btn"
                    onClick={() => deleteBadge(badge.id)}
                    disabled={badge.id === OPIC_STAFF_BADGE_ID}
                    title={badge.id === OPIC_STAFF_BADGE_ID ? 'Reserved system badge' : undefined}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {activeTab === 'staff' && (
      <section className="admin-section">
        <h2>Opic Staff</h2>
        <p className="admin-section-intro">
          Search users and toggle the <strong>Opic Staff</strong> badge (<code>{OPIC_STAFF_BADGE_ID}</code>). Staff show a gold <strong>STAFF</strong> tag in chat and member lists. The badge is created automatically when the API starts.
        </p>
        <div className="admin-user-search">
          <input
            placeholder="Search by username, display name, or user id (empty = first 30 users)"
            value={staffQuery}
            onChange={(e) => setStaffQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchStaffUsers()}
          />
          <button type="button" onClick={searchStaffUsers} disabled={searchingStaff}>
            {searchingStaff ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="admin-user-list">
          {staffResults.length === 0 ? (
            <p className="admin-empty">Search to list users, then toggle Opic Staff.</p>
          ) : (
            staffResults.map((u) => (
              <div key={u._id} className="admin-user-item admin-staff-user-item">
                <div className="admin-user-head">
                  <div className="admin-staff-user-meta">
                    <strong>{u.display_name || u.username}</strong>
                    <span>{u.username}#{u.discriminator}</span>
                    <code>{u._id}</code>
                  </div>
                  <label className="admin-checkbox admin-staff-toggle">
                    <input
                      type="checkbox"
                      checked={userHasOpicStaff(u)}
                      onChange={(e) => toggleUserStaff(u._id, e.target.checked)}
                    />
                    Opic Staff
                  </label>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      )}

      {activeTab === 'users' && (
      <section className="admin-section">
        <h2>Users</h2>
        <p className="admin-section-intro">
          Search accounts, assign global badges, grant privileged access, or <strong>disable</strong> accounts (blocks login and all API access).
        </p>
        <div className="admin-user-search">
          <input
            placeholder="Search by username, display name, or user id"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
          />
          <button onClick={searchUsers} disabled={searchingUsers}>{searchingUsers ? 'Searching...' : 'Search'}</button>
        </div>
        <div className="admin-user-list">
          {userResults.map((u) => (
            <div key={u._id} className="admin-user-item">
              <div className="admin-user-head">
                <strong>{u.display_name || u.username}</strong>
                <span>{u.username}#{u.discriminator}</span>
                <code>{u._id}</code>
                <label className="admin-checkbox admin-privileged">
                  <input
                    type="checkbox"
                    checked={!!u.privileged}
                    onChange={(e) => setUserPrivileged(u._id, e.target.checked)}
                  />
                  Privileged
                </label>
                <label className={`admin-checkbox admin-disabled${u._id === officialClawId ? ' admin-checkbox-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={!!u.disabled}
                    disabled={u._id === officialClawId}
                    onChange={(e) => setUserDisabled(u._id, e.target.checked)}
                  />
                  Account disabled
                </label>
              </div>
              {u._id !== officialClawId && (
                <div className="admin-user-disable-row">
                  <input
                    className="admin-disable-reason-input"
                    placeholder="Optional reason (stored when you disable the account)"
                    value={
                      userDisableReasonDraft[u._id] !== undefined
                        ? userDisableReasonDraft[u._id]
                        : (u.disabled_reason || '')
                    }
                    onChange={(e) => setUserDisableReasonDraft((prev) => ({ ...prev, [u._id]: e.target.value }))}
                  />
                  {u.disabled && (
                    <button
                      type="button"
                      className="admin-link-btn admin-disable-reason-save"
                      onClick={() => setUserDisabled(u._id, true)}
                    >
                      Update reason
                    </button>
                  )}
                </div>
              )}
              <div className="admin-user-badges">
                {activeBadges.map((b) => {
                  const checked = (userBadgeDrafts[u._id] || []).includes(b.id);
                  return (
                    <label key={`${u._id}-${b.id}`} className="admin-badge-check">
                      <input type="checkbox" checked={checked} onChange={() => toggleUserBadge(u._id, b.id)} />
                      {b.icon?.url && <img src={resolveFileUrl(b.icon)} alt="" />}
                      <span>{b.label}</span>
                    </label>
                  );
                })}
              </div>
              <button onClick={() => saveUserBadges(u._id)}>Save User Badges</button>
            </div>
          ))}
        </div>
      </section>
      )}

      {activeTab === 'moderation' && (
      <section className="admin-section admin-moderation">
        <div className="admin-moderation-head">
          <h2>Reports</h2>
          <button
            type="button"
            onClick={() => loadReportList()}
            disabled={loadingReports}
            className="admin-link-btn"
          >
            {loadingReports ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <p className="admin-section-intro">
          {reportTotal.toLocaleString()} total
          {reportList.length < reportTotal ? ` · showing ${reportList.length}` : ''}
        </p>
        {loadingReports && reportList.length === 0 ? (
          <p className="admin-stats-loading">Loading reports…</p>
        ) : reportList.length === 0 ? (
          <p className="admin-empty">No reports.</p>
        ) : (
          <div className="admin-report-list">
            {reportList.map((r) => {
              const detail = reportDetailById[r.id];
              const open = expandedReportId === r.id;
              let detailText = '';
              if (detail?.content !== undefined) {
                try {
                  detailText = typeof detail.content === 'string'
                    ? detail.content
                    : JSON.stringify(detail.content, null, 2);
                } catch {
                  detailText = String(detail.content);
                }
              }
              return (
                <div key={r.id} className="admin-report-card">
                  <div className="admin-report-row">
                    <div className="admin-report-meta">
                      <span>{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</span>
                      <code className="admin-report-id">{r.id}</code>
                    </div>
                    <div className="admin-report-actions">
                      <button type="button" className="admin-link-btn" onClick={() => toggleReportDetail(r.id)}>
                        {open ? 'Hide detail' : 'View full payload'}
                      </button>
                      <button type="button" className="admin-danger-btn" onClick={() => deleteReport(r.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="admin-report-reporter">
                    <strong>{r.author_display_name || r.author_username || 'Unknown'}</strong>
                    <code className="admin-id-sub">{r.author_id}</code>
                  </div>
                  <div className="admin-report-reason"><span>Reason:</span> {r.reason || '—'}</div>
                  <div className="admin-report-preview">{r.content_preview || '—'}</div>
                  {open && detailText ? (
                    <pre className="admin-report-json">{detailText}</pre>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {activeTab === 'public-servers' && (
      <section className="admin-section admin-public-servers">
        <div className="admin-moderation-head">
          <h2>Public server listings</h2>
          <button
            type="button"
            onClick={() => loadPublicServers()}
            disabled={loadingPublicServers}
            className="admin-link-btn"
          >
            {loadingPublicServers ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <p className="admin-section-intro">
          Approve or reject owner requests for vanity invite URLs and optional discovery listing.
        </p>
        {loadingPublicServers && publicServersPending.length === 0 ? (
          <p className="admin-stats-loading">Loading queue…</p>
        ) : publicServersPending.length === 0 ? (
          <p className="admin-empty">No pending public listing requests.</p>
        ) : (
          <div className="admin-mini-table-wrap">
            <table className="admin-mini-table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Owner</th>
                  <th>Requested slug</th>
                  <th>Requested</th>
                  <th>Override slug</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {publicServersPending.map((s) => {
                  const sid = s._id;
                  return (
                    <tr key={sid}>
                      <td>
                        <div>{s.name || '—'}</div>
                        <code className="admin-id-sub">{sid}</code>
                      </td>
                      <td>
                        {s.owner_user ? (
                          <>
                            <div>{s.owner_user.username}#{s.owner_user.discriminator}</div>
                            <code className="admin-id-sub">{s.owner}</code>
                          </>
                        ) : (
                          <code className="admin-id-sub">{s.owner}</code>
                        )}
                      </td>
                      <td><code>{s.public_slug_requested || '—'}</code></td>
                      <td>{s.public_requested_at ? new Date(s.public_requested_at).toLocaleString() : '—'}</td>
                      <td>
                        <input
                          type="text"
                          className="admin-inline-input"
                          placeholder="Optional"
                          value={publicApproveSlugDraft[sid] || ''}
                          onChange={(e) => setPublicApproveSlugDraft((prev) => ({ ...prev, [sid]: e.target.value }))}
                        />
                      </td>
                      <td className="admin-table-actions">
                        <button type="button" className="admin-link-btn" onClick={() => approvePublicServer(sid)}>
                          Approve
                        </button>
                        <button type="button" className="admin-danger-btn" onClick={() => rejectPublicServer(sid)}>
                          Reject
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}
    </div>
  );
}
