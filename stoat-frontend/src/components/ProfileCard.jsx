import { useEffect, useState } from 'react';
import { resolveFileUrl } from '../utils/avatarUrl';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { get } from '../api';
import { loadSystemBadgeMap } from '../utils/systemBadges';
import './ProfileCard.css';

function getProfile(user) {
  return user?.profile || {};
}

function getDisplayName(user, member) {
  return member?.nickname || user?.display_name || user?.username || 'Unknown';
}

function getTag(user) {
  if (!user?.username) return '';
  return `${user.username}#${user.discriminator || '0000'}`;
}

function getBannerStyle(user) {
  const p = getProfile(user);
  const bannerUrl = resolveFileUrl(p.banner || p.background);
  if (bannerUrl) return { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  if (p.accent_color) return { background: p.accent_color };
  return {};
}

export default function ProfileCard({
  user,
  member,
  roleMap = null,
  style,
  className = '',
  onClose,
  showBackdrop = false,
  showActions = true,
}) {
  const navigate = useNavigate();
  const { user: me } = useAuth();
  const p = getProfile(user);
  const [badgeMap, setBadgeMap] = useState({});
  const displayName = getDisplayName(user, member);
  const avatarUrl = resolveFileUrl(member?.avatar || user?.avatar);
  const systemBadges = Array.isArray(user?.system_badges) ? user.system_badges : [];
  const links = Array.isArray(p.social_links) ? p.social_links : [];
  const bio = p.bio || p.content || '';
  const themeClass = p.theme_preset ? `theme-${p.theme_preset}` : 'theme-default';
  const canMessage = Boolean(user?._id && me?._id && user._id !== me._id);
  const memberRoles = (() => {
    const ids = Array.isArray(member?.roles) ? member.roles : [];
    const mapObj = roleMap && typeof roleMap === 'object' ? roleMap : {};
    const resolved = ids
      .map((id) => mapObj[id])
      .filter(Boolean)
      .sort((a, b) => (Number(b?.rank) || 0) - (Number(a?.rank) || 0));
    return resolved;
  })();

  useEffect(() => {
    let mounted = true;
    loadSystemBadgeMap().then((map) => {
      if (!mounted) return;
      setBadgeMap(map || {});
    });
    return () => { mounted = false; };
  }, []);

  const openDm = async () => {
    if (!user?._id) return;
    try {
      const dm = await get(`/users/${user._id}/dm`);
      if (dm?._id) {
        if (onClose) onClose();
        navigate(`/channels/@me/${dm._id}`);
      }
    } catch {}
  };

  return (
    <>
      {showBackdrop && <div className="profile-card-backdrop" onClick={onClose} />}
      <div className={`profile-card ${themeClass} ${className}`} style={style} onClick={(e) => e.stopPropagation()}>
        <div className={`profile-card-banner ${p.effect ? `effect-${p.effect}` : ''}`} style={getBannerStyle(user)} />
        <div className="profile-card-body">
          <div className={`profile-card-avatar-wrap ${p.decoration ? `decor-${p.decoration}` : ''}`}>
            <div className="profile-card-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="profile-card-avatar-img" />
              ) : (
                (displayName[0] || '?').toUpperCase()
              )}
            </div>
          </div>

          <div className="profile-card-name-row">
            <div className="profile-card-name">{displayName}</div>
            {p.pronouns && <div className="profile-card-pronouns">{p.pronouns}</div>}
          </div>
          <div className="profile-card-tag">{getTag(user)}</div>

          {user?.status?.text && <div className="profile-card-status">{user.status.text}</div>}
          {bio && <div className="profile-card-bio">{bio}</div>}

          {systemBadges.length > 0 && (
            <div className="profile-card-badges">
              {systemBadges.map((badgeId, i) => {
                const meta = badgeMap[badgeId] || { label: badgeId, description: '' };
                const iconUrl = resolveFileUrl(meta.icon);
                return (
                  <span
                    key={`${badgeId}-${i}`}
                    className="profile-card-badge system-badge"
                    title={meta.description ? `${meta.label} - ${meta.description}` : meta.label}
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt="" className="profile-card-badge-icon-img" />
                    ) : (
                      <span className="profile-card-badge-icon" aria-hidden="true">🏷️</span>
                    )}
                    {meta.label}
                  </span>
                );
              })}
            </div>
          )}

          {memberRoles.length > 0 && (
            <div className="profile-card-roles">
              {memberRoles.map((r, i) => (
                <span
                  key={`${r._id || r.id || r.name || 'role'}-${i}`}
                  className="profile-card-role"
                  style={r?.colour ? { borderColor: r.colour, color: r.colour } : {}}
                  title={r?.name || 'Role'}
                >
                  {r?.name || 'Role'}
                </span>
              ))}
            </div>
          )}

          {links.length > 0 && (
            <div className="profile-card-links">
              {links.map((l, i) => (
                <a key={`${l.url}-${i}`} href={l.url} target="_blank" rel="noreferrer" className="profile-card-link">
                  {l.label || 'Link'}
                </a>
              ))}
            </div>
          )}

          {showActions && (
            <div className="profile-card-actions">
              {canMessage && (
                <button type="button" className="profile-card-action-btn" onClick={openDm}>
                  Message
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
