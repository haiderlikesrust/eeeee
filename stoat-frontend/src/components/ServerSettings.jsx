import { useState, useEffect, useRef, useMemo } from 'react';
import { get, post, patch, del, put, uploadFile } from '../api';
import { resolveFileUrl } from '../utils/avatarUrl';
import { isBotUser } from '../utils/botDisplay';
import ServerOwnerCrown from './ServerOwnerCrown';
import { showServerOwnerCrownForUser } from '../utils/serverOwnerCrownDisplay';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  Permissions, PERMISSION_INFO, CHANNEL_PERMISSION_INFO,
  hasPermission, hasServerPermission, hasEffectiveRolePermission, toggleRolePermissionBitmask,
  DEFAULT_EVERYONE_PERMS,
} from '../utils/permissions';
import './ServerSettings.css';

function PermissionEditor({ value, onChange, items, label }) {
  return (
    <div className="perm-editor">
      {label && <h4 className="perm-editor-title">{label}</h4>}
      <div className="perm-list">
        {items.map((p) => {
          const bit = Permissions[p.key];
          const isAdmin = p.key === 'ADMINISTRATOR';
          const enabled = isAdmin
            ? (Number(value) & bit) === bit
            : hasEffectiveRolePermission(value, bit);
          return (
            <div key={p.key} className={`perm-row ${p.dangerous ? 'dangerous' : ''}`}>
              <div className="perm-info">
                <span className="perm-name">{p.label}</span>
                <span className="perm-desc">{p.description}</span>
              </div>
              <button
                type="button"
                className={`perm-toggle ${enabled ? 'on' : 'off'}`}
                onClick={() => onChange(toggleRolePermissionBitmask(value, p.key, bit))}
                title={enabled ? 'Disable' : 'Enable'}
              >
                <div className="perm-toggle-track">
                  <div className="perm-toggle-thumb" />
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelOverrideEditor({ value, onChange, items }) {
  const allow = value?.allow || 0;
  const deny = value?.deny || 0;

  const getState = (bit) => {
    if ((deny & bit) === bit) return 'deny';
    if ((allow & bit) === bit) return 'allow';
    return 'neutral';
  };

  const cycle = (bit) => {
    const current = getState(bit);
    let newAllow = allow;
    let newDeny = deny;
    if (current === 'neutral') {
      newAllow |= bit; newDeny &= ~bit;
    } else if (current === 'allow') {
      newAllow &= ~bit; newDeny |= bit;
    } else {
      newAllow &= ~bit; newDeny &= ~bit;
    }
    onChange({ allow: newAllow, deny: newDeny });
  };

  return (
    <div className="perm-list channel-overrides">
      {items.map((p) => {
        const bit = Permissions[p.key];
        const state = getState(bit);
        return (
          <div key={p.key} className="perm-row">
            <div className="perm-info">
              <span className="perm-name">{p.label}</span>
              <span className="perm-desc">{p.description}</span>
            </div>
            <button className={`override-btn ${state}`} onClick={() => cycle(bit)} title={state}>
              {state === 'allow' && (
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              )}
              {state === 'deny' && (
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              )}
              {state === 'neutral' && (
                <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 13H5v-2h14v2z"/></svg>
              )}
              <span className="override-label">{state === 'allow' ? 'Allow' : state === 'deny' ? 'Deny' : 'Neutral'}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Dark-themed dropdown for "Add Role" (replaces native select so list isn't white). */
function RoleAssignDropdown({ assignableRoles, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  if (!assignableRoles || assignableRoles.length === 0) return null;
  return (
    <div className="role-assign-dropdown" ref={ref}>
      <button type="button" className="role-assign-trigger" onClick={() => setOpen(!open)}>
        + Add Role
        <svg width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>
      </button>
      {open && (
        <ul className="role-assign-list">
          {assignableRoles.map((r) => (
            <li key={r.id}>
              <button type="button" className="role-assign-option" onClick={() => { onSelect(r.id); setOpen(false); }}>
                <span className="role-dot-sm" style={{ background: r.colour || 'var(--text-muted)' }} />
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ServerSettings({ server, serverId, onClose, onUpdated, userPerms }) {
  const { user } = useAuth();
  const toast = useToast();

  const isOwner = user?._id === server?.owner;
  const canManageServer = isOwner || hasServerPermission(userPerms, Permissions.MANAGE_SERVER);
  const canManageRoles = isOwner || hasServerPermission(userPerms, Permissions.MANAGE_ROLES);
  const canManageChannels = isOwner || hasServerPermission(userPerms, Permissions.MANAGE_CHANNELS);
  const canKick = isOwner || hasServerPermission(userPerms, Permissions.KICK_MEMBERS);
  const canBan = isOwner || hasServerPermission(userPerms, Permissions.BAN_MEMBERS);
  const canManageMembers = canKick || canBan || canManageRoles;

  const availableTabs = [];
  if (canManageServer) availableTabs.push('overview');
  if (canManageRoles) availableTabs.push('roles', 'permissions', 'channels');
  if (canManageServer) availableTabs.push('emojis');
  if (canManageMembers) availableTabs.push('members');
  availableTabs.push('invites');
  if (canBan) availableTabs.push('bans');
  if (canManageServer) availableTabs.push('wordfilter', 'auditlog');
  const uniqueTabs = [...new Set(availableTabs)];

  const [tab, setTab] = useState(uniqueTabs[0] || 'overview');
  const [name, setName] = useState(server?.name || '');
  const [description, setDescription] = useState(server?.description || '');
  const [locked, setLocked] = useState(server?.locked ?? false);
  const [roles, setRoles] = useState([]);
  const [bans, setBans] = useState([]);
  const [invites, setInvites] = useState([]);
  const [members, setMembers] = useState([]);
  const transferCandidates = useMemo(() => {
    if (!user?._id) return [];
    return members.filter((m) => {
      const u = typeof m.user === 'object' ? m.user : null;
      if (!u?._id) return false;
      if (u._id === user._id) return false;
      if (isBotUser(u)) return false;
      return true;
    });
  }, [members, user?._id]);
  const [channels, setChannels] = useState([]);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#5865f2');
  const [editingRole, setEditingRole] = useState(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleColor, setEditRoleColor] = useState('');
  const [editRoleHoist, setEditRoleHoist] = useState(false);
  const [editRolePerms, setEditRolePerms] = useState(0);
  const [saving, setSaving] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [defaultPerms, setDefaultPerms] = useState(server?.default_permissions ?? DEFAULT_EVERYONE_PERMS);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [channelOverrides, setChannelOverrides] = useState({});
  const [selectedOverrideRole, setSelectedOverrideRole] = useState('everyone');
  const [emojis, setEmojis] = useState([]);
  const [newEmojiName, setNewEmojiName] = useState('');
  const [emojiUploading, setEmojiUploading] = useState(false);
  const iconInputRef = useRef(null);
  const emojiInputRef = useRef(null);
  const [wordFilter, setWordFilter] = useState(server?.word_filter || []);
  const [newWord, setNewWord] = useState('');
  const [auditLogs, setAuditLogs] = useState([]);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const getServerIconUrl = () => resolveFileUrl(server?.icon);
  const getErrMsg = (err, fallback) => err?.error || err?.message || fallback;

  const handleIconUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIconUploading(true);
    try {
      const uploaded = await uploadFile(file);
      const updated = await patch(`/servers/${serverId}`, { icon: uploaded });
      if (onUpdated) onUpdated(updated);
      toast.success('Server icon updated');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to update server icon'));
    }
    setIconUploading(false);
    if (iconInputRef.current) iconInputRef.current.value = '';
  };

  useEffect(() => {
    if (server?.locked != null) setLocked(server.locked);
  }, [server?.locked]);

  useEffect(() => {
    setTransferTargetId('');
  }, [serverId]);

  useEffect(() => {
    if (tab === 'overview' && isOwner) loadMembers();
  }, [tab, isOwner, serverId]);

  useEffect(() => {
    if (tab === 'roles') fetchRoles();
    if (tab === 'bans') loadBans();
    if (tab === 'invites') loadInvites();
    if (tab === 'members') { loadMembers(); fetchRoles(); }
    if (tab === 'channels') { loadChannels(); fetchRoles(); }
    if (tab === 'permissions') fetchRoles();
    if (tab === 'emojis') loadEmojis();
    if (tab === 'wordfilter') setWordFilter(server?.word_filter || []);
    if (tab === 'auditlog') loadAuditLog();
  }, [tab]);

  const fetchRoles = async () => {
    try {
      const s = await get(`/servers/${serverId}`);
      const r = s?.roles || {};
      const parsed = Object.entries(typeof r === 'object' ? r : {}).map(([id, role]) => ({
        id, ...role, rank: role.rank ?? 0,
      }));
      parsed.sort((a, b) => b.rank - a.rank);
      setRoles(parsed);
      setDefaultPerms(s?.default_permissions ?? DEFAULT_EVERYONE_PERMS);
      if (onUpdated) onUpdated(s);
    } catch {}
  };

  const loadChannels = async () => {
    try {
      const s = await get(`/servers/${serverId}`);
      const chs = (s?.channels || []).filter(c => typeof c === 'object');
      setChannels(chs);
    } catch {}
  };

  const loadBans = async () => { try { const res = await get(`/servers/${serverId}/bans`); setBans(res?.bans || []); } catch {} };
  const loadInvites = async () => { try { const res = await get(`/servers/${serverId}/invites`); setInvites(res || []); } catch {} };
  const loadMembers = async () => { try { const res = await get(`/servers/${serverId}/members`); setMembers(res || []); } catch {} };
  const loadEmojis = async () => { try { const res = await get(`/servers/${serverId}/emojis`); setEmojis(res || []); } catch {} };
  const handleEmojiUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !newEmojiName.trim()) return;
    setEmojiUploading(true);
    try {
      const uploaded = await uploadFile(file);
      await post(`/servers/${serverId}/emojis`, {
        name: newEmojiName.replace(/[^a-zA-Z0-9_]/g, ''),
        file_id: uploaded._id,
        url: uploaded.url,
        animated: file.type === 'image/gif',
      });
      setNewEmojiName('');
      await loadEmojis();
      toast.success('Emoji uploaded');
    } catch (err) {
      toast.error(getErrMsg(err, 'Emoji upload failed'));
    }
    setEmojiUploading(false);
    if (emojiInputRef.current) emojiInputRef.current.value = '';
  };
  const deleteEmoji = async (emojiId) => {
    if (!confirm('Delete this emoji?')) return;
    try {
      await del(`/servers/${serverId}/emojis/${emojiId}`);
      setEmojis(prev => prev.filter(e => e._id !== emojiId));
      toast.success('Emoji deleted');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to delete emoji'));
    }
  };
  const renameEmoji = async (emojiId, newName) => {
    try {
      await patch(`/servers/${serverId}/emojis/${emojiId}`, { name: newName });
      await loadEmojis();
      toast.success('Emoji renamed');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to rename emoji'));
    }
  };

  const saveOverview = async () => {
    setSaving(true);
    try {
      const payload = { name, description };
      if (isOwner) payload.locked = locked;
      const updated = await patch(`/servers/${serverId}`, payload);
      if (onUpdated) onUpdated(updated);
      setLocked(updated.locked ?? false);
      toast.success('Server settings saved');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to save server settings'));
    }
    setSaving(false);
  };

  const saveDefaultPerms = async () => {
    try {
      await put(`/servers/${serverId}/permissions/default`, { permissions: defaultPerms });
      await fetchRoles();
      toast.success('@everyone permissions updated');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to save permissions'));
    }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    const lowestRank = roles.length > 0 ? Math.min(...roles.map((r) => r.rank)) : 0;
    try {
      await post(`/servers/${serverId}/roles`, { name: newRoleName, colour: newRoleColor || null, rank: lowestRank - 1, permissions: 0 });
      setNewRoleName('');
      setNewRoleColor('#5865f2');
      await fetchRoles();
      toast.success('Role created');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to create role'));
    }
  };

  const deleteRole = async (roleId) => {
    if (!confirm('Delete this role? Members will lose it.')) return;
    try {
      await del(`/servers/${serverId}/roles/${roleId}`);
      await fetchRoles();
      toast.success('Role deleted');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to delete role'));
    }
  };

  const saveRole = async () => {
    if (!editingRole) return;
    try {
      await patch(`/servers/${serverId}/roles/${editingRole}`, {
        name: editRoleName || undefined,
        colour: editRoleColor || null,
        hoist: editRoleHoist,
        permissions: editRolePerms,
      });
      setEditingRole(null);
      await fetchRoles();
      toast.success('Role updated');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to update role'));
    }
  };

  const moveRole = async (roleId, direction) => {
    const idx = roles.findIndex((r) => r.id === roleId);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= roles.length) return;
    const rankUpdates = {};
    rankUpdates[roles[idx].id] = roles[swapIdx].rank;
    rankUpdates[roles[swapIdx].id] = roles[idx].rank;
    try {
      await patch(`/servers/${serverId}/roles/ranks`, { roles: rankUpdates });
      await fetchRoles();
      toast.success('Role order updated');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to reorder roles'));
    }
  };

  const unban = async (userId) => {
    try {
      await del(`/servers/${serverId}/bans/${userId}`);
      setBans(prev => prev.filter(b => (b.user?._id || b.user) !== userId));
      toast.success('Member unbanned');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to unban member'));
    }
  };
  const deleteInvite = async (code) => {
    try {
      await del(`/invites/${code}`);
      setInvites(prev => prev.filter(i => i._id !== code));
      toast.success('Invite revoked');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to revoke invite'));
    }
  };
  const kickMember = async (memberId) => {
    if (!confirm('Kick?')) return;
    try {
      await del(`/servers/${serverId}/members/${memberId}`);
      setMembers(prev => prev.filter(m => m._id !== memberId));
      toast.success('Member kicked');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to kick member'));
    }
  };
  const banMember = async (userId) => {
    const reason = prompt('Ban reason (optional):') || '';
    try {
      await put(`/servers/${serverId}/bans/${userId}`, { reason });
      setMembers(prev => prev.filter(m => (typeof m.user === 'object' ? m.user._id : m.user) !== userId));
      toast.success('Member banned');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to ban member'));
    }
  };
  const toggleMemberRole = async (memberId, roleId, add) => {
    try {
      const member = members.find(m => m._id === memberId);
      if (!member) return;
      const currentRoles = member.roles || [];
      const newRoles = add ? [...new Set([...currentRoles, roleId])] : currentRoles.filter(r => r !== roleId);
      await patch(`/servers/${serverId}/members/${memberId}`, { roles: newRoles });
      setMembers(prev => prev.map(m => m._id === memberId ? { ...m, roles: newRoles } : m));
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to update member roles'));
    }
  };

  const getMemberName = (m) => m.nickname || (typeof m.user === 'object' ? (m.user.display_name || m.user.username) : 'Unknown') || 'Unknown';
  const getMemberUserId = (m) => typeof m.user === 'object' ? m.user._id : m.user;

  const transferOwnership = async () => {
    if (!transferTargetId) return;
    const targetMember = members.find((m) => getMemberUserId(m) === transferTargetId);
    const label = targetMember ? getMemberName(targetMember) : 'this member';
    if (!confirm(`Transfer ownership to ${label}? You will lose owner-only controls (deleting the server, transferring again). You cannot undo this yourself.`)) return;
    setTransferSubmitting(true);
    try {
      const updated = await post(`/servers/${serverId}/transfer-ownership`, { user_id: transferTargetId });
      if (onUpdated) onUpdated(updated);
      setTransferTargetId('');
      toast.success('Ownership transferred');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to transfer ownership'));
    }
    setTransferSubmitting(false);
  };

  const getMemberAvatarUrl = (m) => resolveFileUrl(typeof m.user === 'object' ? m.user?.avatar : null);
  const getHighestRole = (m) => {
    const mRoles = (m.roles || []).map(rId => roles.find(r => r.id === rId)).filter(Boolean);
    return mRoles.length ? mRoles.reduce((a, b) => (a.rank > b.rank ? a : b), mRoles[0]) : null;
  };

  const sortedMembers = [...members].sort((a, b) => {
    const oA = getMemberUserId(a) === server?.owner;
    const oB = getMemberUserId(b) === server?.owner;
    if (oA !== oB) return oA ? -1 : 1;
    const rA = getHighestRole(a)?.rank ?? -Infinity;
    const rB = getHighestRole(b)?.rank ?? -Infinity;
    if (rA !== rB) return rB - rA;
    return getMemberName(a).localeCompare(getMemberName(b));
  });

  const loadChannelOverrides = async (ch) => {
    setSelectedChannel(ch);
    const dp = ch.default_permissions || { allow: 0, deny: 0 };
    const rp = ch.role_permissions || {};
    const rpObj = rp instanceof Map ? Object.fromEntries(rp) : (typeof rp === 'object' ? rp : {});
    setChannelOverrides({ everyone: typeof dp === 'object' ? dp : { allow: 0, deny: 0 }, ...rpObj });
    setSelectedOverrideRole('everyone');
  };

  const saveChannelOverride = async () => {
    if (!selectedChannel) return;
    try {
      if (selectedOverrideRole === 'everyone') {
        await put(`/channels/${selectedChannel._id}/permissions/default`, channelOverrides.everyone || { allow: 0, deny: 0 });
      } else {
        await put(`/channels/${selectedChannel._id}/permissions/${selectedOverrideRole}`, channelOverrides[selectedOverrideRole] || { allow: 0, deny: 0 });
      }
      toast.success('Channel override saved');
      // Refetch channels so this channel's overrides are up to date and UI stays in sync
      const s = await get(`/servers/${serverId}`);
      const chs = (s?.channels || []).filter(c => typeof c === 'object');
      setChannels(chs);
      const updated = chs.find(c => c._id === selectedChannel._id);
      if (updated) setSelectedChannel(updated);
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to save channel override'));
    }
  };

  const removeChannelOverride = async (roleId) => {
    if (!selectedChannel || roleId === 'everyone') return;
    try {
      await del(`/channels/${selectedChannel._id}/permissions/${roleId}`);
      setChannelOverrides(prev => { const n = { ...prev }; delete n[roleId]; return n; });
      toast.success('Channel override removed');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to remove channel override'));
    }
  };

  const addFilterWord = async () => {
    const w = newWord.trim();
    if (!w || wordFilter.includes(w)) return;
    const updated = [...wordFilter, w];
    try {
      await patch(`/servers/${serverId}`, { word_filter: updated });
      setWordFilter(updated);
      setNewWord('');
      toast.success('Word added to filter');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to update word filter'));
    }
  };

  const removeFilterWord = async (word) => {
    const updated = wordFilter.filter((w) => w !== word);
    try {
      await patch(`/servers/${serverId}`, { word_filter: updated });
      setWordFilter(updated);
      toast.success('Word removed from filter');
    } catch (err) {
      toast.error(getErrMsg(err, 'Failed to update word filter'));
    }
  };

  const loadAuditLog = async () => {
    try {
      const res = await get(`/servers/${serverId}/audit-log?limit=50`);
      setAuditLogs(Array.isArray(res) ? res : []);
    } catch { setAuditLogs([]); }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-sidebar">
          <div className="settings-title">{server?.name || 'Server'}</div>
          {uniqueTabs.includes('overview') && <div className={`settings-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</div>}
          {uniqueTabs.includes('roles') && <div className={`settings-tab ${tab === 'roles' ? 'active' : ''}`} onClick={() => setTab('roles')}>Roles</div>}
          {uniqueTabs.includes('permissions') && <div className={`settings-tab ${tab === 'permissions' ? 'active' : ''}`} onClick={() => setTab('permissions')}>@everyone Perms</div>}
          {uniqueTabs.includes('channels') && <div className={`settings-tab ${tab === 'channels' ? 'active' : ''}`} onClick={() => setTab('channels')}>Channel Overrides</div>}
          {uniqueTabs.includes('emojis') && <div className={`settings-tab ${tab === 'emojis' ? 'active' : ''}`} onClick={() => setTab('emojis')}>Emojis</div>}
          {uniqueTabs.includes('members') && <div className={`settings-tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>Members</div>}
          {uniqueTabs.includes('invites') && <div className={`settings-tab ${tab === 'invites' ? 'active' : ''}`} onClick={() => setTab('invites')}>Invites</div>}
          {uniqueTabs.includes('bans') && <div className={`settings-tab ${tab === 'bans' ? 'active' : ''}`} onClick={() => setTab('bans')}>Bans</div>}
          {uniqueTabs.includes('wordfilter') && <div className={`settings-tab ${tab === 'wordfilter' ? 'active' : ''}`} onClick={() => setTab('wordfilter')}>Word Filter</div>}
          {uniqueTabs.includes('auditlog') && <div className={`settings-tab ${tab === 'auditlog' ? 'active' : ''}`} onClick={() => setTab('auditlog')}>Audit Log</div>}
          <div className="settings-separator" />
          <div className="settings-tab close-tab" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            Close
          </div>
        </div>
        <div className="settings-content">
          {tab === 'overview' && (
            <div className="settings-section">
              <h2>Server Overview</h2>
              <div className="server-icon-upload">
                <div className="server-icon-preview" onClick={() => iconInputRef.current?.click()}>
                  {getServerIconUrl() ? <img src={getServerIconUrl()} alt="icon" className="server-icon-img" /> : <span>{(server?.name || 'S').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</span>}
                  <div className="server-icon-overlay">{iconUploading ? '...' : 'Edit'}</div>
                </div>
                <input type="file" accept="image/*" ref={iconInputRef} style={{ display: 'none' }} onChange={handleIconUpload} />
                <span className="server-icon-hint">Click to change server icon</span>
              </div>
              <label className="auth-label"><span>SERVER NAME</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="auth-label"><span>DESCRIPTION</span><textarea className="settings-textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} /></label>
              {isOwner && (
                <div className="settings-toggle-row">
                  <div className="settings-toggle-info">
                    <span className="settings-toggle-label">Lock server</span>
                    <span className="settings-toggle-desc">No new members can join, even with an invite link.</span>
                  </div>
                  <button
                    type="button"
                    className={`perm-toggle ${locked ? 'on' : 'off'}`}
                    onClick={() => setLocked((v) => !v)}
                    title={locked ? 'Unlock server' : 'Lock server'}
                  >
                    <div className="perm-toggle-track">
                      <div className="perm-toggle-thumb" />
                    </div>
                  </button>
                </div>
              )}
              {isOwner && (
                <div className="transfer-ownership-block">
                  <h3 className="transfer-ownership-title">Transfer ownership</h3>
                  <p className="settings-hint transfer-ownership-desc">
                    Make another member the server owner. You will keep membership but lose owner-only actions. Bots cannot receive ownership.
                  </p>
                  {transferCandidates.length === 0 ? (
                    <p className="settings-empty transfer-ownership-empty">Add at least one non-bot member to transfer ownership.</p>
                  ) : (
                    <>
                      <label className="auth-label">
                        <span>New owner</span>
                        <select
                          className="transfer-ownership-select"
                          value={transferTargetId}
                          onChange={(e) => setTransferTargetId(e.target.value)}
                        >
                          <option value="">Select a member…</option>
                          {transferCandidates.map((m) => {
                            const uid = typeof m.user === 'object' ? m.user._id : m.user;
                            return (
                              <option key={m._id} value={uid}>
                                {getMemberName(m)}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="settings-danger-btn transfer-ownership-btn"
                        disabled={!transferTargetId || transferSubmitting}
                        onClick={transferOwnership}
                      >
                        {transferSubmitting ? 'Transferring…' : 'Transfer ownership'}
                      </button>
                    </>
                  )}
                </div>
              )}
              <button className="modal-btn primary" onClick={saveOverview} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
            </div>
          )}

          {tab === 'permissions' && (
            <div className="settings-section">
              <h2>@everyone Default Permissions</h2>
              <p className="settings-hint">These permissions apply to every member as the base layer. Roles add on top of this.</p>
              <PermissionEditor value={defaultPerms} onChange={setDefaultPerms} items={PERMISSION_INFO.filter(p => p.key !== 'ADMINISTRATOR')} />
              <button className="modal-btn primary" onClick={saveDefaultPerms} style={{ marginTop: 16 }}>Save @everyone Permissions</button>
            </div>
          )}

          {tab === 'roles' && (
            <div className="settings-section">
              <h2>Roles</h2>
              <p className="settings-hint">Higher roles have more authority. Hierarchy determines who can manage whom.</p>
              <div className="settings-add-row">
                <input type="color" className="role-color-picker" value={newRoleColor} onChange={(e) => setNewRoleColor(e.target.value)} title="Role color" />
                <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="New role name" onKeyDown={(e) => e.key === 'Enter' && createRole()} />
                <button className="modal-btn primary" onClick={createRole}>Create</button>
              </div>
              {roles.length === 0 && <p className="settings-empty">No custom roles</p>}
              <div className="role-hierarchy-list">
                {roles.map((r, idx) => (
                  <div key={r.id} className={`role-hierarchy-item ${editingRole === r.id ? 'editing' : ''}`}>
                    <div className="role-hierarchy-rank">
                      <button className="role-move-btn" disabled={idx === 0} onClick={() => moveRole(r.id, 'up')} title="Move up">
                        <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>
                      </button>
                      <span className="role-rank-number">{idx + 1}</span>
                      <button className="role-move-btn" disabled={idx === roles.length - 1} onClick={() => moveRole(r.id, 'down')} title="Move down">
                        <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
                      </button>
                    </div>
                    <div className="role-color-dot" style={{ background: r.colour || 'var(--text-muted)' }} />
                    <span className="role-hierarchy-name" style={{ color: r.colour || 'var(--text-normal)' }}>{r.name}</span>
                    {r.hoist && <span className="role-hoist-badge">Hoisted</span>}
                    {hasPermission(r.permissions || 0, Permissions.ADMINISTRATOR) && <span className="role-admin-badge">Admin</span>}
                    <div className="role-hierarchy-actions">
                      <button className="settings-warn-btn" onClick={() => { setEditingRole(r.id); setEditRoleName(r.name); setEditRoleColor(r.colour || '#99aab5'); setEditRoleHoist(!!r.hoist); setEditRolePerms(r.permissions || 0); }}>Edit</button>
                      <button className="settings-danger-btn" onClick={() => deleteRole(r.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>

              {editingRole && (
                <div className="role-edit-panel">
                  <h3>Edit Role</h3>
                  <div className="settings-add-row">
                    <input type="color" className="role-color-picker" value={editRoleColor} onChange={(e) => setEditRoleColor(e.target.value)} />
                    <input value={editRoleName} onChange={(e) => setEditRoleName(e.target.value)} placeholder="Role name" />
                  </div>
                  <label className="role-checkbox-label">
                    <input type="checkbox" checked={editRoleHoist} onChange={(e) => setEditRoleHoist(e.target.checked)} />
                    <span>Display role members separately (hoist)</span>
                  </label>
                  <PermissionEditor value={editRolePerms} onChange={setEditRolePerms} items={PERMISSION_INFO} label="Role Permissions" />
                  <div className="modal-actions">
                    <button className="modal-btn secondary" onClick={() => setEditingRole(null)}>Cancel</button>
                    <button className="modal-btn primary" onClick={saveRole}>Save Role</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'channels' && (
            <div className="settings-section">
              <h2>Channel Permission Overrides</h2>
              <p className="settings-hint">Override permissions per-channel per-role. Deny always overrides Allow.</p>
              <div className="channel-override-layout">
                <div className="channel-override-list">
                  {channels.map(ch => (
                    <div key={ch._id} className={`channel-override-item ${selectedChannel?._id === ch._id ? 'active' : ''}`} onClick={() => loadChannelOverrides(ch)}>
                      <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d={ch.channel_type === 'VoiceChannel' ? 'M12 3a9 9 0 0 0-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7a9 9 0 0 0-9-9z' : 'M5.88 21a1 1 0 0 1-.98-1.18l.56-3.28-2.39-2.32a1 1 0 0 1 .56-1.71l3.3-.48L8.4 9.1a1 1 0 0 1 1.8 0l1.47 2.93 3.3.48a1 1 0 0 1 .56 1.71l-2.39 2.32.56 3.28a1 1 0 0 1-1.45 1.05L9.3 19.35l-2.96 1.56a1 1 0 0 1-.46.09z'} /></svg>
                      <span>{ch.name}</span>
                    </div>
                  ))}
                </div>
                {selectedChannel && (
                  <div className="channel-override-editor">
                    <h3>#{selectedChannel.name}</h3>
                    <p className="override-editing-label">Editing overrides for: <strong>{selectedOverrideRole === 'everyone' ? '@everyone' : (roles.find(r => r.id === selectedOverrideRole)?.name || selectedOverrideRole)}</strong></p>
                    <div className="override-role-tabs" role="tablist" aria-label="Select role to edit">
                      <button
                        role="tab"
                        aria-selected={selectedOverrideRole === 'everyone'}
                        className={`override-role-tab ${selectedOverrideRole === 'everyone' ? 'active' : ''}`}
                        onClick={() => setSelectedOverrideRole('everyone')}
                      >
                        @everyone
                      </button>
                      {roles.map(r => (
                        <button
                          key={r.id}
                          role="tab"
                          aria-selected={selectedOverrideRole === r.id}
                          className={`override-role-tab ${selectedOverrideRole === r.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedOverrideRole(r.id);
                            if (!channelOverrides[r.id]) setChannelOverrides(prev => ({ ...prev, [r.id]: { allow: 0, deny: 0 } }));
                          }}
                          style={{ borderColor: selectedOverrideRole === r.id ? (r.colour || 'var(--accent)') : 'transparent' }}
                        >
                          <span className="role-dot-sm" style={{ background: r.colour || 'var(--text-muted)' }} />
                          {r.name}
                        </button>
                      ))}
                    </div>
                    <ChannelOverrideEditor
                      value={channelOverrides[selectedOverrideRole] || { allow: 0, deny: 0 }}
                      onChange={(val) => setChannelOverrides(prev => ({ ...prev, [selectedOverrideRole]: val }))}
                      items={CHANNEL_PERMISSION_INFO}
                    />
                    <div className="modal-actions" style={{ marginTop: 12 }}>
                      {selectedOverrideRole !== 'everyone' && (
                        <button className="modal-btn secondary" onClick={() => removeChannelOverride(selectedOverrideRole)}>Remove Override</button>
                      )}
                      <button className="modal-btn primary" onClick={saveChannelOverride}>Save Override</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'emojis' && (
            <div className="settings-section">
              <h2>Emojis &mdash; {emojis.length}/250</h2>
              <p className="settings-hint">Upload custom emojis for this server. Members can use them in messages with :name: syntax.</p>
              <div className="emoji-upload-row">
                <input
                  value={newEmojiName}
                  onChange={e => setNewEmojiName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                  placeholder="emoji_name"
                  className="emoji-name-input"
                />
                <button
                  className="modal-btn primary"
                  onClick={() => emojiInputRef.current?.click()}
                  disabled={!newEmojiName.trim() || emojiUploading}
                >
                  {emojiUploading ? 'Uploading...' : 'Upload Image'}
                </button>
                <input type="file" accept="image/*" ref={emojiInputRef} style={{ display: 'none' }} onChange={handleEmojiUpload} />
              </div>
              {emojis.length === 0 && <p className="settings-empty">No custom emojis yet</p>}
              <div className="emoji-grid-manage">
                {emojis.map(em => (
                  <div key={em._id} className="emoji-manage-item">
                    <img src={em.url} alt={em.name} className="emoji-manage-img" />
                    <span className="emoji-manage-name">:{em.name}:</span>
                    <button className="settings-danger-btn emoji-delete-btn" onClick={() => deleteEmoji(em._id)} title="Delete">
                      <svg width="14" height="14" viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'members' && (
            <div className="settings-section">
              <h2>Members &mdash; {members.length}</h2>
              {sortedMembers.map((m) => {
                const memberRoleIds = m.roles || [];
                const isMemberOwner = getMemberUserId(m) === server?.owner;
                const highestRole = getHighestRole(m);
                const avatarUrl = getMemberAvatarUrl(m);
                return (
                  <div key={m._id} className="settings-member-card">
                    <div className="settings-list-item">
                      <div className="settings-list-info">
                        <div className="settings-member-avatar" style={highestRole?.colour ? { background: highestRole.colour } : {}}>
                          {avatarUrl ? <img src={avatarUrl} alt="" className="settings-member-avatar-img" /> : getMemberName(m)[0]?.toUpperCase()}
                          {showServerOwnerCrownForUser(typeof m.user === 'object' ? m.user : null, server?.owner, getMemberUserId(m)) && <ServerOwnerCrown size="settings" />}
                        </div>
                        <div>
                          <span className="settings-list-name" style={highestRole?.colour ? { color: highestRole.colour } : {}}>
                            {getMemberName(m)}
                            {isMemberOwner && <span className="owner-badge">Owner</span>}
                          </span>
                          <div className="settings-member-roles">
                            {memberRoleIds.map(rId => {
                              const role = roles.find(r => r.id === rId);
                              return role ? (
                                <span key={rId} className="settings-role-tag" style={{ borderColor: role.colour || 'var(--text-muted)' }}>
                                  <span className="role-dot-sm" style={{ background: role.colour || 'var(--text-muted)' }} />
                                  {role.name}
                                  <span className="role-remove" onClick={() => toggleMemberRole(m._id, rId, false)} title="Remove role">
                                    <svg width="10" height="10" viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                                  </span>
                                </span>
                              ) : null;
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="settings-member-actions">
                        {canManageRoles && (
                          <RoleAssignDropdown
                            assignableRoles={roles.filter(r => !memberRoleIds.includes(r.id))}
                            onSelect={(roleId) => toggleMemberRole(m._id, roleId, true)}
                          />
                        )}
                        {!isMemberOwner && (
                          <>
                            {canKick && <button className="settings-warn-btn" onClick={() => kickMember(m._id)}>Kick</button>}
                            {canBan && <button className="settings-danger-btn" onClick={() => banMember(getMemberUserId(m))}>Ban</button>}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'invites' && (
            <div className="settings-section">
              <h2>Invites</h2>
              {invites.length === 0 && <p className="settings-empty">No active invites</p>}
              {invites.map(inv => (
                <div key={inv._id} className="settings-list-item">
                  <div className="settings-list-info">
                    <span className="settings-list-name invite-code">{inv._id}</span>
                    <span className="settings-list-sub">by {typeof inv.creator === 'object' ? inv.creator.username : inv.creator}</span>
                  </div>
                  <button className="settings-danger-btn" onClick={() => deleteInvite(inv._id)}>Revoke</button>
                </div>
              ))}
            </div>
          )}

          {tab === 'bans' && (
            <div className="settings-section">
              <h2>Bans</h2>
              {bans.length === 0 && <p className="settings-empty">No bans</p>}
              {bans.map(b => {
                const userId = typeof b.user === 'object' ? b.user._id : b.user;
                const userName = typeof b.user === 'object' ? b.user.username : b.user;
                return (
                  <div key={b._id} className="settings-list-item">
                    <div className="settings-list-info">
                      <span className="settings-list-name">{userName}</span>
                      {b.reason && <span className="settings-list-sub">{b.reason}</span>}
                    </div>
                    <button className="settings-warn-btn" onClick={() => unban(userId)}>Unban</button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'wordfilter' && (
            <div className="settings-section">
              <h2>Word Filter</h2>
              <p className="settings-hint">Messages containing these words will be blocked automatically.</p>
              <div className="settings-add-row">
                <input value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="Add blocked word..." onKeyDown={(e) => e.key === 'Enter' && addFilterWord()} />
                <button className="modal-btn primary" onClick={addFilterWord}>Add</button>
              </div>
              {wordFilter.length === 0 && <p className="settings-empty">No blocked words</p>}
              <div className="settings-tag-list">
                {wordFilter.map((w) => (
                  <span key={w} className="settings-tag">
                    {w}
                    <button className="settings-tag-remove" onClick={() => removeFilterWord(w)} aria-label="Remove">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {tab === 'auditlog' && (
            <div className="settings-section">
              <h2>Audit Log</h2>
              {auditLogs.length === 0 && <p className="settings-empty">No entries yet</p>}
              {auditLogs.map((log) => (
                <div key={log._id} className="settings-list-item">
                  <div className="settings-list-info">
                    <span className="settings-list-name">{typeof log.user === 'object' ? (log.user.display_name || log.user.username) : 'Unknown'}</span>
                    <span className="settings-list-sub">{log.action} — {log.target_type ? `${log.target_type} ${log.target_id?.slice(0, 8)}` : ''}</span>
                  </div>
                  <span className="settings-list-sub">{log.created_at ? new Date(log.created_at).toLocaleString() : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
