import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveFileUrl } from '../utils/avatarUrl';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import { get } from '../api';
import { loadSystemBadgeMap } from '../utils/systemBadges';
import './ProfileCard.css';

const PROFILE_CARD_PORTAL_Z = 1100;

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
  const { isMobile } = useMobile();
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
  const isPopupCard = Boolean(style && (style.position === 'fixed' || style.left !== undefined || style.top !== undefined));
  const isMobilePopup = Boolean(isMobile && isPopupCard);
  const effectiveStyle = isMobilePopup
    ? {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: PROFILE_CARD_PORTAL_Z + 1,
    }
    : style;

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

  const cardContent = (
    <>
      {(showBackdrop || isMobilePopup) && (
        <div
          className="profile-card-backdrop"
          onClick={onClose}
          style={isMobilePopup ? { zIndex: PROFILE_CARD_PORTAL_Z, background: 'rgba(0,0,0,0.6)' } : undefined}
        />
      )}
      <div
        className={`profile-card ${themeClass} ${isMobilePopup ? 'popup-mobile' : ''} ${className}`}
        style={effectiveStyle}
        onClick={(e) => e.stopPropagation()}
      >
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

  useEffect(() => {
    let mounted = true;
    loadSystemBadgeMap().then((map) => {
      if (!mounted) return;
      setBadgeMap(map || {});
    });
    return () => { mounted = false; };
  }, []);

  if (isMobilePopup && typeof document !== 'undefined' && document.body) {
    return createPortal(
      <div
        className="profile-card-portal"
        style={{ position: 'fixed', inset: 0, zIndex: PROFILE_CARD_PORTAL_Z }}
      >
        {cardContent}
      </div>,
      document.body
    );
  }

  return cardContent;
}
