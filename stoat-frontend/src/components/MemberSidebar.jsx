import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobile } from '../context/MobileContext';
import { resolveFileUrl } from '../utils/avatarUrl';
import { get } from '../api';
import ProfileCard from './ProfileCard';
import { activityTypeLabel, formatActivityPrimary, formatActivitySecondary, resolveActivityImageUrl } from '../utils/activityDisplay';
import ActivityElapsed from './ActivityElapsed';
import ActivityMiniIcon from './ActivityMiniIcon';
import './MemberSidebar.css';

export default function MemberSidebar({ members, serverRoles }) {
  const { user } = useAuth();
  const { isMobile: isMobileDevice, mobileOverlay, closeMobileOverlay } = useMobile();
  const isDrawerOpen = isMobileDevice && mobileOverlay === 'memberSidebar';
  if (!members || members.length === 0) return null;

  const roles = serverRoles instanceof Map
    ? Object.fromEntries(serverRoles.entries())
    : (serverRoles || {});

  const getName = (m) => {
    if (m.nickname) return m.nickname;
    if (typeof m.user === 'object' && m.user) {
      return m.user.display_name || m.user.username || 'Unknown';
    }
    return 'Unknown';
  };

  const getInitial = (m) => getName(m)[0]?.toUpperCase() || '?';

  const getAvatarUrl = (m) => {
    const u = typeof m.user === 'object' ? m.user : null;
    return resolveFileUrl(u?.avatar);
  };

  const getTag = (m) => {
    if (typeof m.user === 'object' && m.user) {
      return `${m.user.username}#${m.user.discriminator || '0000'}`;
    }
    return '';
  };

  const isBotMember = (m) => {
    const u = typeof m.user === 'object' ? m.user : null;
    const owner = u?.bot?.owner;
    return typeof owner === 'string' && owner.trim().length > 0;
  };

  const isOnlineMember = (m) => {
    const u = typeof m.user === 'object' ? m.user : null;
    if (!u) return false;
    if (u.online === true) return true;
    return u?.status?.presence === 'Online';
  };

  const getPresence = (m) => {
    const u = typeof m.user === 'object' ? m.user : null;
    if (!u || !u.online) return 'offline';
    const p = (u?.status?.presence || 'Online').toLowerCase();
    return p === 'invisible' ? 'offline' : p;
  };

  const getStatusText = (m) => {
    const u = typeof m.user === 'object' ? m.user : null;
    const t = u?.status?.text;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
  };

  const getActivity = (m) => {
    const u = typeof m.user === 'object' ? m.user : null;
    const a = u?.status?.activity;
    if (!a?.type || !a?.name?.trim()) return null;
    return a;
  };

  const getMemberRoles = (m) => (m.roles || [])
    .map((rId) => roles[rId])
    .filter(Boolean);

  const getHighestRole = (m) => {
    const memberRoles = getMemberRoles(m);
    if (memberRoles.length === 0) return null;
    return memberRoles.reduce((best, r) => {
      const bestRank = best?.rank ?? -Infinity;
      const rRank = r?.rank ?? 0;
      return rRank > bestRank ? r : best;
    }, memberRoles[0]);
  };

  const getTopColor = (m) => {
    const highest = getHighestRole(m);
    return highest?.colour || null;
  };

  const getHoistedRole = (m) => {
    const memberRoles = getMemberRoles(m);
    const hoisted = memberRoles
      .filter((r) => r.hoist)
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    return hoisted.length > 0 ? hoisted[0] : null;
  };

  const sortMembersByName = (arr) => [...arr].sort((a, b) => {
    const an = getName(a).toLowerCase();
    const bn = getName(b).toLowerCase();
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });

  const onlineMembers = members.filter(isOnlineMember);
  const offlineMembers = members.filter((m) => !isOnlineMember(m));
  const sortedOffline = sortMembersByName(offlineMembers);

  // Group by highest hoisted role (online members only in role sections)
  const roleGroups = {};
  const ungrouped = [];

  for (const m of onlineMembers) {
    const hoisted = getHoistedRole(m);
    if (hoisted) {
      const key = hoisted._id || hoisted.name;
      if (!roleGroups[key]) roleGroups[key] = { role: hoisted, members: [] };
      roleGroups[key].members.push(m);
    } else {
      ungrouped.push(m);
    }
  }

  const sortedGroups = Object.values(roleGroups)
    .sort((a, b) => (Number(b.role.rank) || 0) - (Number(a.role.rank) || 0))
    .map((g) => ({ ...g, members: sortMembersByName(g.members) }))
    .filter((g) => g.members.length > 0);
  const sortedUngrouped = sortMembersByName(ungrouped);

  return (
    <div className="member-sidebar" role={isDrawerOpen ? 'dialog' : undefined} aria-modal={isDrawerOpen ? 'true' : undefined} aria-label={isDrawerOpen ? 'Members' : undefined}>
      {isMobileDevice && (
        <div className="member-sidebar-header">
          <button type="button" className="member-sidebar-back" onClick={closeMobileOverlay} aria-label="Back">
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
          <span className="member-sidebar-title">Members</span>
        </div>
      )}
      {sortedGroups.map((group) => (
        <div key={group.role._id || group.role.name}>
          <div className="member-category" style={group.role.colour ? { color: group.role.colour } : {}}>
            {(group.role.name || 'Role')} &mdash; {group.members.length}
          </div>
          {group.members.map((m) => (
            <MemberItem
              key={m._id}
              member={m}
              roleMap={roles}
              name={getName(m)}
              initial={getInitial(m)}
              topColor={getTopColor(m)}
              avatarUrl={getAvatarUrl(m)}
              isBot={isBotMember(m)}
              isOnline={isOnlineMember(m)}
              presence={getPresence(m)}
              statusText={getStatusText(m)}
              activity={getActivity(m)}
            />
          ))}
        </div>
      ))}
      {(sortedUngrouped.length > 0) && (
        <>
          <div className="member-category">
            MEMBERS &mdash; {sortedUngrouped.length}
          </div>
          {sortedUngrouped.map((m) => (
            <MemberItem
              key={m._id}
              member={m}
              roleMap={roles}
              name={getName(m)}
              initial={getInitial(m)}
              topColor={getTopColor(m)}
              avatarUrl={getAvatarUrl(m)}
              isBot={isBotMember(m)}
              isOnline={true}
              presence={getPresence(m)}
              statusText={getStatusText(m)}
              activity={getActivity(m)}
            />
          ))}
        </>
      )}
      {sortedOffline.length > 0 && (
        <>
          <div className="member-category member-category-offline">
            Offline &mdash; {sortedOffline.length}
          </div>
          {sortedOffline.map((m) => (
            <MemberItem
              key={m._id}
              member={m}
              roleMap={roles}
              name={getName(m)}
              initial={getInitial(m)}
              topColor={getTopColor(m)}
              avatarUrl={getAvatarUrl(m)}
              isBot={isBotMember(m)}
              isOnline={false}
              presence="offline"
              statusText={getStatusText(m)}
              activity={getActivity(m)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function MemberItem({ member, roleMap, name, initial, topColor, avatarUrl, isBot, isOnline, presence = 'offline', statusText, activity }) {
  const activityImg = activity ? resolveActivityImageUrl(activity.image) : null;
  const [showPopup, setShowPopup] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const itemRef = useRef(null);
  const [popupStyle, setPopupStyle] = useState({});

  useEffect(() => {
    if (showPopup && itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      const popupWidth = 340;
      const popupHeight = 320;
      let top = rect.top;
      let left = rect.left - popupWidth - 12;

      if (left < 0) left = rect.right + 12;
      if (top + popupHeight > window.innerHeight) {
        top = window.innerHeight - popupHeight - 16;
      }
      if (top < 0) top = 8;

      setPopupStyle({ top: `${top}px`, left: `${left}px` });
    }
  }, [showPopup]);

  const getUserId = () => {
    if (typeof member.user === 'object') return member.user._id;
    return member.user;
  };

  const openDM = async () => {
    const targetId = getUserId();
    if (!targetId || targetId === user?._id) return;
    try {
      const dm = await get(`/users/${targetId}/dm`);
      if (dm?._id) {
        navigate(`/channels/@me/${dm._id}`);
        setShowPopup(false);
      }
    } catch {}
  };

  return (
    <div className={`member-item-wrap${!isOnline ? ' member-item-offline' : ''}`} ref={itemRef}>
      <div className="member-item" onClick={() => setShowPopup(!showPopup)}>
        <div className="member-avatar" style={topColor ? { background: topColor } : {}}>
          {avatarUrl ? <img src={avatarUrl} alt={name} className="member-avatar-img" /> : initial}
          {isOnline && <span className={`member-online-dot presence-${presence}`} title={presence === 'idle' ? 'Idle' : presence === 'busy' ? 'Busy' : 'Online'} />}
        </div>
        <div className="member-info-col">
          <div className="member-name-row">
            <span className="member-name" style={topColor ? { color: topColor } : {}}>{name}</span>
            {isBot && (
              <span className="member-bot-badge" title="Bot">
                <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                  <use href="/icons.svg#bot-icon" />
                </svg>
                BOT
              </span>
            )}
          </div>
          {(activity || statusText) && (
            <div className={`member-rich-presence${activity && statusText ? ' member-rich-presence-both' : ''}`}>
              {activity && (
                <div
                  className="member-activity-card"
                  title={`${formatActivityPrimary(activity) || ''}${formatActivitySecondary(activity) ? ` — ${formatActivitySecondary(activity)}` : ''}`}
                >
                  <div className="member-activity-card-art">
                    {activityImg ? (
                      <img src={activityImg} alt="" className="member-activity-art-img" />
                    ) : (
                      <div className="member-activity-art-fallback" aria-hidden="true">
                        <ActivityMiniIcon type={activity.type} size={22} />
                      </div>
                    )}
                  </div>
                  <div className="member-activity-card-body">
                    <div className="member-activity-k">{activityTypeLabel(activity.type)}</div>
                    <div className="member-activity-title">{activity.name}</div>
                    {formatActivitySecondary(activity) && (
                      <div className="member-activity-sub">{formatActivitySecondary(activity)}</div>
                    )}
                    {activity.started_at && (
                      <div className="member-activity-elapsed" title="Time in this session">
                        <ActivityElapsed startedAt={activity.started_at} />
                        <span className="member-activity-elapsed-suffix">elapsed</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {statusText && (
                <div className={`member-custom-status-line ${activity ? 'with-activity' : ''}`} title={statusText}>
                  <span className="member-custom-status-dot" aria-hidden="true">◆</span>
                  <span className="member-custom-status-text">{statusText}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {showPopup && (
        <>
          <div className="member-popup-backdrop" onClick={() => setShowPopup(false)} />
          <ProfileCard
            user={typeof member.user === 'object' ? member.user : null}
            member={member}
            roleMap={roleMap}
            style={{ ...popupStyle, position: 'fixed' }}
            className="member-popup"
            showBackdrop={false}
            onClose={() => setShowPopup(false)}
          />
        </>
      )}
    </div>
  );
}
