import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { resolveFileUrl } from '../utils/avatarUrl';
import { clearSystemBadgeCache } from '../utils/systemBadges';
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

  const [email, setEmail] = useState('admin@admin.com');
  const [password, setPassword] = useState('admin123');
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

  const activeBadges = useMemo(() => badges.filter((b) => b.active), [badges]);

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
      } catch {
        setAdminToken('');
        setToken('');
        setMe(null);
      }
      setChecking(false);
    };
    boot();
  }, []);

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

  const login = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await adminFetch('/login', { method: 'POST', body: { email, password } });
      setAdminToken(res.token);
      setToken(res.token);
      setMe(res.admin || { email });
      await loadBadges(res.token);
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

  const deleteBadge = async (badgeId) => {
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
      (users || []).forEach((u) => { draft[u._id] = Array.isArray(u.system_badges) ? u.system_badges : []; });
      setUserBadgeDrafts(draft);
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
          <p>{me.email}</p>
        </div>
        <div className="admin-header-actions">
          <Link to="/channels/@me" className="admin-link-btn">Open App</Link>
          <button onClick={logout} className="admin-danger-btn">Logout</button>
        </div>
      </header>

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
                  <div className="admin-badge-id">{badge.id}</div>
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
                      onChange={(e) => setBadges((prev) => prev.map((b) => b.id === badge.id ? { ...b, active: e.target.checked } : b))}
                    />
                    Active
                  </label>
                  <button onClick={() => saveBadge(badge)}>Save</button>
                  <button className="admin-danger-btn" onClick={() => deleteBadge(badge.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <h2>Assign Badges to Users</h2>
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
              </div>
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
    </div>
  );
}
