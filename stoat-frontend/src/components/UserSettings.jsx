import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, patch, del, uploadFile } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import ProfileCard from './ProfileCard';
import './UserSettings.css';

export default function UserSettings({ onClose }) {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('profile');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [statusText, setStatusText] = useState(user?.status?.text || '');
  const [presence, setPresence] = useState(user?.status?.presence || 'Online');
  const [bio, setBio] = useState(user?.profile?.bio || user?.profile?.content || '');
  const [pronouns, setPronouns] = useState(user?.profile?.pronouns || '');
  const [accentColor, setAccentColor] = useState(user?.profile?.accent_color || '#5865f2');
  const [themePreset, setThemePreset] = useState(user?.profile?.theme_preset || 'default');
  const [decoration, setDecoration] = useState(user?.profile?.decoration || '');
  const [effect, setEffect] = useState(user?.profile?.effect || '');
  const [bannerUrl, setBannerUrl] = useState(resolveFileUrl(user?.profile?.banner || user?.profile?.background) || '');
  const [bannerAsset, setBannerAsset] = useState(user?.profile?.banner || user?.profile?.background || null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [socialLinks, setSocialLinks] = useState(
    Array.isArray(user?.profile?.social_links) && user.profile.social_links.length > 0
      ? user.profile.social_links.slice(0, 3).map((l) => ({ label: l.label || '', url: l.url || '' }))
      : [{ label: '', url: '' }]
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passError, setPassError] = useState('');
  const [passSuccess, setPassSuccess] = useState('');

  const [sessions, setSessions] = useState([]);

  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);
  const getErrMsg = (err, fallback) => err?.error || err?.message || fallback;

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const uploaded = await uploadFile(file);
      const updated = await patch('/users/@me', { avatar: uploaded });
      if (updated) setUser((prev) => ({ ...prev, ...updated }));
      toast.success('Avatar updated');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to update avatar'));
    }
    setAvatarUploading(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const getAvatarUrl = () => resolveFileUrl(user?.avatar);

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBannerUploading(true);
    try {
      const uploaded = await uploadFile(file);
      setBannerAsset(uploaded);
      setBannerUrl(uploaded.url || '');
      toast.success('Banner uploaded');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to upload banner'));
    }
    setBannerUploading(false);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  };

  useEffect(() => {
    if (tab === 'sessions') loadSessions();
  }, [tab]);

  const loadSessions = async () => {
    try {
      const res = await get('/auth/session');
      setSessions(Array.isArray(res) ? res : []);
    } catch { setSessions([]); }
  };

  const saveProfile = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const body = {};
      if (displayName !== (user?.display_name || '')) body.display_name = displayName || null;
      if (statusText !== (user?.status?.text || '') || presence !== (user?.status?.presence || 'Online')) {
        body.status = { ...(user?.status || {}), text: statusText || null, presence: presence || 'Online' };
      }
      body.profile = {
        bio: bio || null,
        content: bio || null,
        pronouns: pronouns || null,
        accent_color: accentColor || null,
        theme_preset: themePreset || null,
        decoration: decoration || null,
        effect: effect || null,
        social_links: socialLinks.filter((l) => l.url?.trim()).map((l) => ({ label: l.label || 'Link', url: l.url.trim() })),
        banner: bannerAsset || (bannerUrl ? { url: bannerUrl } : null),
      };
      const updated = await patch('/users/@me', body);
      if (updated) setUser((prev) => ({ ...prev, ...updated }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      toast.success('Profile saved');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to save profile'));
    }
    setSaving(false);
  };

  const changePassword = async () => {
    setPassError('');
    setPassSuccess('');
    if (!currentPassword || !newPassword) { setPassError('Both fields required'); return; }
    if (newPassword.length < 6) { setPassError('Password must be at least 6 characters'); return; }
    try {
      await patch('/auth/account', { current_password: currentPassword, password: newPassword });
      setPassSuccess('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      toast.success('Password changed');
    } catch (err) {
      setPassError(err?.error || 'Failed to change password');
      toast.error(getErrMsg(err, 'Failed to change password'));
    }
  };

  const changeUsername = async () => {
    setUsernameError('');
    setUsernameSuccess('');
    if (!newUsername.trim()) { setUsernameError('Username required'); return; }
    if (!usernamePassword) { setUsernameError('Password required'); return; }
    try {
      await patch('/users/@me/username', { username: newUsername, password: usernamePassword });
      setUser((prev) => ({ ...prev, username: newUsername }));
      setUsernameSuccess('Username changed');
      setUsernamePassword('');
      toast.success('Username changed');
    } catch (err) {
      setUsernameError(err?.error || 'Failed to change username');
      toast.error(getErrMsg(err, 'Failed to change username'));
    }
  };

  const revokeSession = async (sessionId) => {
    try {
      await del(`/auth/session/${sessionId}`);
      setSessions((prev) => prev.filter((s) => s._id !== sessionId));
      toast.success('Session revoked');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to revoke session'));
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-sidebar">
          <div className="settings-title">User Settings</div>
          <div className={`settings-tab ${tab === 'profile' ? 'active' : ''}`} onClick={() => setTab('profile')}>My Profile</div>
          <div className={`settings-tab ${tab === 'account' ? 'active' : ''}`} onClick={() => setTab('account')}>Account</div>
          <div className={`settings-tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>Sessions</div>
          <div
            className="settings-tab"
            onClick={() => {
              onClose?.();
              navigate('/developers');
            }}
          >
            Developer Portal
          </div>
          <div className="settings-separator" />
          <div className="settings-tab close-tab" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            Close
          </div>
          <div className="settings-separator" />
          <div className="settings-tab close-tab" style={{ color: 'var(--red-400)' }} onClick={logout}>
            Log Out
          </div>
        </div>
        <div className="settings-content">
          {tab === 'profile' && (
            <div className="settings-section">
              <h2>My Profile</h2>
              <div className="profile-card">
                <div className="profile-banner" />
                <div className="profile-card-body">
                  <div className="profile-avatar-row">
                    <div className="profile-avatar-large clickable" onClick={() => avatarInputRef.current?.click()}>
                      {getAvatarUrl() ? (
                        <img src={getAvatarUrl()} alt="avatar" className="profile-avatar-img" />
                      ) : (
                        (user?.username || 'U')[0].toUpperCase()
                      )}
                      <div className="profile-avatar-overlay">
                        {avatarUploading ? '...' : 'Edit'}
                      </div>
                    </div>
                    <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: 'none' }} onChange={handleAvatarUpload} />
                    <div className="profile-name-display">
                      <span className="profile-big-name">{user?.display_name || user?.username}</span>
                      <span className="profile-big-tag">{user?.username}#{user?.discriminator || '0000'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="profile-preview-wrap">
                <div className="settings-subhead">Live Preview</div>
                <ProfileCard
                  user={{
                    ...user,
                    display_name: displayName || user?.display_name,
                    status: { ...(user?.status || {}), text: statusText || null },
                    profile: {
                      ...(user?.profile || {}),
                      bio: bio || null,
                      content: bio || null,
                      pronouns: pronouns || null,
                      accent_color: accentColor || null,
                      theme_preset: themePreset || null,
                      decoration: decoration || null,
                      effect: effect || null,
                      social_links: socialLinks.filter((l) => l.url?.trim()).map((l) => ({ label: l.label || 'Link', url: l.url.trim() })),
                      banner: bannerAsset || (bannerUrl ? { url: bannerUrl } : null),
                    },
                  }}
                  showActions={false}
                />
              </div>

              <label className="auth-label">
                <span>DISPLAY NAME</span>
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={user?.username} />
              </label>
              <label className="auth-label">
                <span>STATUS</span>
                <select value={presence} onChange={(e) => setPresence(e.target.value)} className="settings-select">
                  <option value="Online">Online</option>
                  <option value="Idle">Idle</option>
                  <option value="Busy">Busy</option>
                  <option value="Invisible">Invisible</option>
                </select>
                <input value={statusText} onChange={(e) => setStatusText(e.target.value)} placeholder="What are you up to?" />
              </label>
              <label className="auth-label">
                <span>ABOUT ME</span>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} className="settings-textarea" placeholder="Tell people about yourself" />
              </label>
              <div className="settings-row-2">
                <label className="auth-label">
                  <span>PRONOUNS</span>
                  <input value={pronouns} onChange={(e) => setPronouns(e.target.value)} placeholder="they/them" />
                </label>
                <label className="auth-label">
                  <span>ACCENT COLOR</span>
                  <div className="profile-color-row">
                    <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="profile-color-input" />
                    <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
                  </div>
                </label>
              </div>
              <div className="settings-row-2">
                <label className="auth-label">
                  <span>THEME PRESET</span>
                  <select value={themePreset} onChange={(e) => setThemePreset(e.target.value)}>
                    <option value="default">Default</option>
                    <option value="midnight">Midnight</option>
                    <option value="forest">Forest</option>
                    <option value="sunset">Sunset</option>
                    <option value="neon">Neon</option>
                  </select>
                </label>
                <label className="auth-label">
                  <span>BANNER URL</span>
                  <input
                    value={bannerUrl}
                    onChange={(e) => {
                      setBannerUrl(e.target.value);
                      setBannerAsset(null);
                    }}
                    placeholder="https://..."
                  />
                </label>
              </div>
              <div className="banner-upload-row">
                <button type="button" className="modal-btn secondary" onClick={() => bannerInputRef.current?.click()}>
                  {bannerUploading ? 'Uploading...' : 'Upload Banner'}
                </button>
                <input type="file" accept="image/*" ref={bannerInputRef} style={{ display: 'none' }} onChange={handleBannerUpload} />
                {bannerUrl && <span className="banner-upload-hint">Banner ready</span>}
              </div>
              <div className="settings-row-2">
                <label className="auth-label">
                  <span>AVATAR DECORATION</span>
                  <select value={decoration} onChange={(e) => setDecoration(e.target.value)}>
                    <option value="">None</option>
                    <option value="ring">Ring</option>
                    <option value="glow">Glow</option>
                    <option value="sparkle">Sparkle</option>
                  </select>
                </label>
                <label className="auth-label">
                  <span>PROFILE EFFECT</span>
                  <select value={effect} onChange={(e) => setEffect(e.target.value)}>
                    <option value="">None</option>
                    <option value="pulse">Pulse</option>
                    <option value="shimmer">Shimmer</option>
                  </select>
                </label>
              </div>
              <div className="settings-subhead">Social Links</div>
              {socialLinks.map((link, idx) => (
                <div className="settings-row-2" key={idx}>
                  <label className="auth-label">
                    <span>LABEL</span>
                    <input
                      value={link.label}
                      onChange={(e) => setSocialLinks((prev) => prev.map((l, i) => i === idx ? { ...l, label: e.target.value } : l))}
                      placeholder="GitHub"
                    />
                  </label>
                  <label className="auth-label">
                    <span>URL</span>
                    <input
                      value={link.url}
                      onChange={(e) => setSocialLinks((prev) => prev.map((l, i) => i === idx ? { ...l, url: e.target.value } : l))}
                      placeholder="https://..."
                    />
                  </label>
                </div>
              ))}
              <button
                className="modal-btn secondary"
                type="button"
                onClick={() => setSocialLinks((prev) => prev.length >= 5 ? prev : [...prev, { label: '', url: '' }])}
                style={{ marginBottom: 12 }}
              >
                Add Social Link
              </button>
              <button className="modal-btn primary" onClick={saveProfile} disabled={saving}>
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
              </button>
            </div>
          )}

          {tab === 'account' && (
            <div className="settings-section">
              <h2>Account</h2>

              <div className="account-card">
                <div className="account-card-row">
                  <div>
                    <div className="account-card-label">USERNAME</div>
                    <div className="account-card-value">{user?.username}#{user?.discriminator || '0000'}</div>
                  </div>
                </div>
                <div className="account-card-row">
                  <div>
                    <div className="account-card-label">EMAIL</div>
                    <div className="account-card-value">{user?.email || '(hidden)'}</div>
                  </div>
                </div>
              </div>

              <h3 style={{ marginTop: 28, marginBottom: 12, color: 'var(--header-primary)' }}>Change Username</h3>
              <label className="auth-label">
                <span>NEW USERNAME</span>
                <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              </label>
              <label className="auth-label">
                <span>CURRENT PASSWORD</span>
                <input type="password" value={usernamePassword} onChange={(e) => setUsernamePassword(e.target.value)} />
              </label>
              {usernameError && <div className="auth-error">{usernameError}</div>}
              {usernameSuccess && <div className="settings-success">{usernameSuccess}</div>}
              <button className="modal-btn primary" onClick={changeUsername}>Change Username</button>

              <h3 style={{ marginTop: 28, marginBottom: 12, color: 'var(--header-primary)' }}>Change Password</h3>
              <label className="auth-label">
                <span>CURRENT PASSWORD</span>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </label>
              <label className="auth-label">
                <span>NEW PASSWORD</span>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </label>
              {passError && <div className="auth-error">{passError}</div>}
              {passSuccess && <div className="settings-success">{passSuccess}</div>}
              <button className="modal-btn primary" onClick={changePassword}>Change Password</button>
            </div>
          )}

          {tab === 'sessions' && (
            <div className="settings-section">
              <h2>Active Sessions</h2>
              {sessions.length === 0 && <p className="settings-empty">No active sessions</p>}
              {sessions.map((s) => (
                <div key={s._id} className="settings-list-item">
                  <div className="settings-list-info">
                    <span className="settings-list-name">{s._id?.slice(0, 12)}...</span>
                    <span className="settings-list-sub">{s.name || 'Session'}</span>
                  </div>
                  <button className="settings-danger-btn" onClick={() => revokeSession(s._id)}>Revoke</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
